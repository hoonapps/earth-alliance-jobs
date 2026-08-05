import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, JsonDB } from 'node-json-db';
import { createTestJob } from '../../test/test-job.factory';
import { JobStatus } from './job.model';
import { JobsRepository } from './jobs.repository';

describe('JobsRepository 동시성', () => {
  let directory: string;
  let repository: JobsRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jobs-repository-'));
    const database = new JsonDB(
      new Config(join(directory, 'jobs.json'), true, true, '/', true),
    );
    repository = new JobsRepository(database);
    await repository.onModuleInit();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('동시에 생성한 모든 작업을 유실 없이 저장한다', async () => {
    const jobs = Array.from({ length: 50 }, (_, index) =>
      createTestJob({ title: `동시 작업 ${index}` }),
    );

    await Promise.all(jobs.map((job) => repository.create(job)));

    const stored = await repository.findAll();
    expect(stored).toHaveLength(50);
    expect(new Set(stored.map((job) => job.id)).size).toBe(50);
  });

  it('이미 초기화된 저장소를 다시 초기화해도 데이터를 유지한다', async () => {
    const job = createTestJob();
    await repository.create(job);

    await repository.onModuleInit();

    await expect(repository.findById(job.id)).resolves.toMatchObject({
      id: job.id,
    });
  });

  it('존재하지 않는 작업 수정은 undefined를 반환한다', async () => {
    await expect(
      repository.update('not-found', (job) => ({ ...job, title: '변경' })),
    ).resolves.toBeUndefined();
  });

  it('대기 작업이 없으면 파일을 다시 쓰지 않고 빈 선점 결과를 반환한다', async () => {
    await repository.create(
      createTestJob({ status: JobStatus.COMPLETED, completedAt: new Date().toISOString() }),
    );

    await expect(
      repository.claimPending(5, new Date(), 60_000),
    ).resolves.toEqual([]);
  });

  it('겹친 선점 요청이 같은 작업을 가져가지 않는다', async () => {
    const jobs = Array.from({ length: 6 }, (_, index) =>
      createTestJob({
        title: `선점 작업 ${index}`,
        createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      }),
    );
    await Promise.all(jobs.map((job) => repository.create(job)));

    const now = new Date('2026-08-05T00:00:00.000Z');
    const [first, second] = await Promise.all([
      repository.claimPending(3, now, 60_000),
      repository.claimPending(3, now, 60_000),
    ]);

    const claimedIds = [...first, ...second].map((job) => job.id);
    expect(claimedIds).toHaveLength(6);
    expect(new Set(claimedIds).size).toBe(6);
  });

  it('만료된 선점을 재선점하고 이전 토큰의 완료 기록을 거절한다', async () => {
    const job = createTestJob();
    await repository.create(job);

    const firstClaim = (
      await repository.claimPending(
        1,
        new Date('2026-08-05T00:00:00.000Z'),
        1_000,
      )
    )[0];
    const secondClaim = (
      await repository.claimPending(
        1,
        new Date('2026-08-05T00:00:02.000Z'),
        1_000,
      )
    )[0];

    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);
    await expect(
      repository.markCompleted(
        job.id,
        firstClaim.claimToken,
        new Date('2026-08-05T00:00:03.000Z'),
      ),
    ).resolves.toBe(false);
    await expect(
      repository.markCompleted(
        job.id,
        secondClaim.claimToken,
        new Date('2026-08-05T00:00:03.000Z'),
      ),
    ).resolves.toBe(true);
    await expect(repository.findById(job.id)).resolves.toMatchObject({
      status: JobStatus.COMPLETED,
      attempts: 2,
    });
  });

  it('존재하지 않거나 processing이 아닌 작업의 완료 처리를 거절한다', async () => {
    const pending = createTestJob();
    await repository.create(pending);

    await expect(
      repository.markCompleted('not-found', 'token', new Date()),
    ).resolves.toBe(false);
    await expect(
      repository.markCompleted(pending.id, 'token', new Date()),
    ).resolves.toBe(false);
  });

  it('jobs 루트가 배열이 아니면 손상된 데이터로 판단한다', async () => {
    const invalidDatabase = new JsonDB(
      new Config(join(directory, 'invalid.json'), true, true, '/', true),
    );
    await invalidDatabase.push('/jobs', { invalid: true }, true);
    const invalidRepository = new JobsRepository(invalidDatabase);

    await expect(invalidRepository.onModuleInit()).rejects.toThrow(
      'jobs.json의 /jobs 값은 배열이어야 합니다.',
    );
  });
});
