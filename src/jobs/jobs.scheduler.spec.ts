import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, JsonDB } from 'node-json-db';
import { createTestJob } from '../../test/test-job.factory';
import { FileLoggerService } from '../common/logging/file-logger.service';
import { JobProcessor } from './job-processor';
import { ClaimedJob, JobStatus } from './job.model';
import { JobsRepository } from './jobs.repository';
import { JobsScheduler } from './jobs.scheduler';

describe('JobsScheduler', () => {
  let directory: string;
  let repository: JobsRepository;
  let previousLogPath: string | undefined;

  beforeEach(async () => {
    previousLogPath = process.env.LOG_FILE_PATH;
    directory = await mkdtemp(join(tmpdir(), 'jobs-scheduler-'));
    process.env.LOG_FILE_PATH = join(directory, 'logs.txt');
    const database = new JsonDB(
      new Config(join(directory, 'jobs.json'), true, true, '/', true),
    );
    repository = new JobsRepository(database);
    await repository.onModuleInit();
  });

  afterEach(async () => {
    if (previousLogPath === undefined) {
      delete process.env.LOG_FILE_PATH;
    } else {
      process.env.LOG_FILE_PATH = previousLogPath;
    }
    await rm(directory, { recursive: true, force: true });
  });

  it('각 작업의 성공과 실패를 격리하여 상태에 반영한다', async () => {
    const success = createTestJob({ title: '성공 작업' });
    const failure = createTestJob({ title: '실패 작업' });
    await repository.create(success);
    await repository.create(failure);

    const processor: JobProcessor = {
      process: jest.fn(async (job: ClaimedJob) => {
        if (job.id === failure.id) {
          throw new Error('의도한 처리 실패');
        }
      }),
    };
    const scheduler = new JobsScheduler(
      repository,
      processor,
      new FileLoggerService(),
    );

    const summary = await scheduler.runOnce();

    expect(summary).toEqual({
      claimed: 2,
      completed: 1,
      failed: 1,
      stale: 0,
      skipped: false,
    });
    await expect(repository.findById(success.id)).resolves.toMatchObject({
      status: JobStatus.COMPLETED,
    });
    await expect(repository.findById(failure.id)).resolves.toMatchObject({
      status: JobStatus.FAILED,
      failureReason: '의도한 처리 실패',
    });
  });

  it('이전 실행이 진행 중이면 겹친 실행을 건너뛴다', async () => {
    await repository.create(createTestJob());
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processor: JobProcessor = {
      process: jest.fn(() => blocked),
    };
    const scheduler = new JobsScheduler(
      repository,
      processor,
      new FileLoggerService(),
    );

    const firstRun = scheduler.runOnce();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const secondRun = await scheduler.runOnce();

    expect(secondRun.skipped).toBe(true);
    release?.();
    await expect(firstRun).resolves.toMatchObject({ completed: 1 });
  });

  it('비활성 설정에서는 interval 실행을 건너뛰고 활성 설정에서는 실행한다', async () => {
    const scheduler = new JobsScheduler(
      repository,
      { process: jest.fn() },
      new FileLoggerService(),
    );
    const runOnce = jest
      .spyOn(scheduler, 'runOnce')
      .mockResolvedValue({
        claimed: 0,
        completed: 0,
        failed: 0,
        stale: 0,
        skipped: false,
      });

    process.env.JOBS_SCHEDULER_ENABLED = 'false';
    await scheduler.handleInterval();
    expect(runOnce).not.toHaveBeenCalled();

    process.env.JOBS_SCHEDULER_ENABLED = 'true';
    await scheduler.handleInterval();
    expect(runOnce).toHaveBeenCalledTimes(1);
    delete process.env.JOBS_SCHEDULER_ENABLED;
  });

  it('저장소 선점 오류를 기록하고 호출자에게 전파한다', async () => {
    const repositoryWithFailure = {
      claimPending: jest.fn().mockRejectedValue(new Error('database failure')),
    } as unknown as JobsRepository;
    const logger = {
      write: jest.fn().mockResolvedValue(undefined),
    } as unknown as FileLoggerService;
    const scheduler = new JobsScheduler(
      repositoryWithFailure,
      { process: jest.fn() },
      logger,
    );

    await expect(scheduler.runOnce()).rejects.toThrow('database failure');
    expect(logger.write).toHaveBeenCalledWith(
      'scheduler.failed',
      expect.objectContaining({ error: 'database failure' }),
    );
    expect(logger.write).toHaveBeenCalledWith(
      'scheduler.finished',
      expect.any(Object),
    );
  });

  it('성공 결과의 선점 토큰이 만료되면 stale 결과로 기록한다', async () => {
    const claimed = createTestJob({
      status: JobStatus.PROCESSING,
      claimToken: 'claim-token',
      leaseUntil: '2026-08-05T00:01:00.000Z',
    }) as ClaimedJob;
    const staleRepository = {
      claimPending: jest.fn().mockResolvedValue([claimed]),
      markCompleted: jest.fn().mockResolvedValue(false),
    } as unknown as JobsRepository;
    const scheduler = new JobsScheduler(
      staleRepository,
      { process: jest.fn().mockResolvedValue(undefined) },
      new FileLoggerService(),
    );

    await expect(scheduler.runOnce()).resolves.toMatchObject({
      stale: 1,
      completed: 0,
    });
  });

  it('실패 결과의 선점 토큰이 만료돼도 덮어쓰지 않는다', async () => {
    const claimed = createTestJob({
      status: JobStatus.PROCESSING,
      claimToken: 'claim-token',
      leaseUntil: '2026-08-05T00:01:00.000Z',
    }) as ClaimedJob;
    const staleRepository = {
      claimPending: jest.fn().mockResolvedValue([claimed]),
      markFailed: jest.fn().mockResolvedValue(false),
    } as unknown as JobsRepository;
    const processor: JobProcessor = {
      process: jest.fn().mockRejectedValue('문자열 실패'),
    };
    const scheduler = new JobsScheduler(
      staleRepository,
      processor,
      new FileLoggerService(),
    );

    await expect(scheduler.runOnce()).resolves.toMatchObject({
      stale: 1,
      failed: 0,
    });
    expect(staleRepository.markFailed).toHaveBeenCalledWith(
      claimed.id,
      claimed.claimToken,
      expect.any(Date),
      '문자열 실패',
    );
  });

  it('로그 쓰기 실패를 작업 실행 실패로 취급하지 않는다', async () => {
    const logger = {
      write: jest.fn().mockRejectedValue(new Error('log failure')),
    } as unknown as FileLoggerService;
    const scheduler = new JobsScheduler(
      repository,
      { process: jest.fn() },
      logger,
    );

    await expect(scheduler.runOnce()).resolves.toMatchObject({
      claimed: 0,
      skipped: false,
    });
  });

  it('환경 변수의 양수만 batch와 lease 설정으로 사용한다', async () => {
    process.env.JOBS_BATCH_SIZE = '-1';
    process.env.JOBS_LEASE_MS = '1';
    const claimPending = jest.fn().mockResolvedValue([]);
    const configuredRepository = {
      claimPending,
    } as unknown as JobsRepository;
    const scheduler = new JobsScheduler(
      configuredRepository,
      { process: jest.fn() },
      new FileLoggerService(),
    );

    await scheduler.runOnce();

    expect(claimPending).toHaveBeenCalledWith(5, expect.any(Date), 1);
    delete process.env.JOBS_BATCH_SIZE;
    delete process.env.JOBS_LEASE_MS;
  });
});
