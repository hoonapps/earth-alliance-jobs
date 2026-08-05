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
});
