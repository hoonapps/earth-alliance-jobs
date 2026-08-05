import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request = require('supertest');
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Jobs API (e2e)', () => {
  let app: INestApplication<App>;
  let directory: string;
  let logPath: string;
  let createdId: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jobs-e2e-'));
    logPath = join(directory, 'logs.txt');
    process.env.JOBS_DB_PATH = join(directory, 'jobs.json');
    process.env.LOG_FILE_PATH = logPath;
    process.env.JOBS_SCHEDULER_ENABLED = 'false';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.JOBS_DB_PATH;
    delete process.env.LOG_FILE_PATH;
    delete process.env.JOBS_SCHEDULER_ENABLED;
    await rm(directory, { recursive: true, force: true });
  });

  it('POST /jobs에서 작업을 생성한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/jobs')
      .send({
        title: '가입 메일 발송',
        description: '신규 회원에게 안내 메일을 보낸다.',
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      title: '가입 메일 발송',
      status: 'pending',
      attempts: 0,
    });
    createdId = response.body.data.id as string;
  });

  it('정의하지 않은 필드를 포함한 요청을 400으로 거절한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/jobs')
      .send({
        title: '잘못된 요청',
        description: '허용되지 않은 필드가 있다.',
        admin: true,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: '요청 값이 올바르지 않습니다.',
      path: '/jobs',
    });
  });

  it('GET /jobs에서 페이지 정보와 작업 목록을 조회한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/jobs?page=1&limit=10')
      .expect(200);

    expect(response.body.meta).toEqual({ page: 1, limit: 10, total: 1 });
    expect(response.body.data[0].id).toBe(createdId);
  });

  it('GET /jobs/search에서 제목과 상태로 검색한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/jobs/search?title=가입&status=pending')
      .expect(200);

    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].id).toBe(createdId);
  });

  it('검색 조건이 없으면 400을 반환한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/jobs/search')
      .expect(400);

    expect(response.body.code).toBe('SEARCH_CONDITION_REQUIRED');
  });

  it('GET /jobs/:id에서 단일 작업을 조회한다', async () => {
    const response = await request(app.getHttpServer())
      .get(`/jobs/${createdId}`)
      .expect(200);

    expect(response.body.data.id).toBe(createdId);
  });

  it('존재하지 않는 작업은 일관된 404 응답을 반환한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/jobs/not-found')
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'JOB_NOT_FOUND',
      path: '/jobs/not-found',
    });
  });

  it('PATCH /jobs/:id에서 pending 작업을 수정한다', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/jobs/${createdId}`)
      .send({ description: '수정한 메일 내용을 발송한다.' })
      .expect(200);

    expect(response.body.data.description).toBe(
      '수정한 메일 내용을 발송한다.',
    );
  });

  it('허용한 pending → cancelled 전이만 적용한다', async () => {
    await request(app.getHttpServer())
      .patch(`/jobs/${createdId}`)
      .send({ status: 'completed' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_STATUS_TRANSITION');
      });

    await request(app.getHttpServer())
      .patch(`/jobs/${createdId}`)
      .send({ status: 'cancelled' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.status).toBe('cancelled');
      });

    await request(app.getHttpServer())
      .patch(`/jobs/${createdId}`)
      .send({ title: '취소 후 변경' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('JOB_NOT_EDITABLE');
      });
  });

  it('완료된 모든 HTTP 요청을 logs.txt에 기록한다', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const logs = await readFile(logPath, 'utf8');
    const requestLogs = logs
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.event === 'http.request');

    expect(requestLogs.length).toBeGreaterThanOrEqual(11);
    expect(requestLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/jobs',
          statusCode: 201,
        }),
        expect.objectContaining({
          method: 'GET',
          path: '/jobs/not-found',
          statusCode: 404,
        }),
      ]),
    );
  });
});
