import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createTestJob } from '../../test/test-job.factory';
import { Job, JobStatus } from './job.model';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';

describe('JobsService 경계 조건', () => {
  it('목록을 최신순으로 정렬하고 페이지로 나눈다', async () => {
    const oldJob = createTestJob({
      id: 'old',
      createdAt: '2026-08-04T00:00:00.000Z',
    });
    const newJob = createTestJob({
      id: 'new',
      createdAt: '2026-08-05T00:00:00.000Z',
    });
    const repository = {
      findAll: jest.fn().mockResolvedValue([oldJob, newJob]),
    } as unknown as JobsRepository;

    await expect(
      new JobsService(repository).findAll({ page: 1, limit: 1 }),
    ).resolves.toEqual({
      items: [newJob],
      total: 2,
      page: 1,
      limit: 1,
    });
  });

  it('제목만 검색할 때 일치 여부를 모두 판별한다', async () => {
    const matching = createTestJob({ title: '가입 메일 발송' });
    const other = createTestJob({ title: '통계 생성' });
    const repository = {
      findAll: jest.fn().mockResolvedValue([matching, other]),
    } as unknown as JobsRepository;

    const result = await new JobsService(repository).search({
      title: '메일',
      page: 1,
      limit: 20,
    });

    expect(result.items).toEqual([matching]);
  });

  it('상태만 검색할 때 일치 여부를 모두 판별한다', async () => {
    const pending = createTestJob({ status: JobStatus.PENDING });
    const completed = createTestJob({ status: JobStatus.COMPLETED });
    const repository = {
      findAll: jest.fn().mockResolvedValue([pending, completed]),
    } as unknown as JobsRepository;

    const result = await new JobsService(repository).search({
      status: JobStatus.COMPLETED,
      page: 1,
      limit: 20,
    });

    expect(result.items).toEqual([completed]);
  });

  it('빈 PATCH 요청을 저장소 호출 전에 거절한다', async () => {
    const repository = {
      update: jest.fn(),
    } as unknown as JobsRepository;

    await expect(new JobsService(repository).update('id', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('존재하지 않는 작업 수정은 404로 변환한다', async () => {
    const repository = {
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobsRepository;

    await expect(
      new JobsService(repository).update('not-found', { title: '변경' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pending 작업의 제목을 수정한다', async () => {
    const pending = createTestJob();
    const repository = updateRepository(pending);

    await expect(
      new JobsService(repository).update(pending.id, { title: '변경한 제목' }),
    ).resolves.toMatchObject({
      title: '변경한 제목',
      description: pending.description,
      status: JobStatus.PENDING,
    });
  });

  it('failed 작업을 pending으로 되돌릴 때 처리 메타데이터를 초기화한다', async () => {
    const failed = createTestJob({
      status: JobStatus.FAILED,
      attempts: 1,
      startedAt: '2026-08-05T00:00:00.000Z',
      failureReason: '처리 실패',
      claimToken: 'old-token',
      leaseUntil: '2026-08-05T00:01:00.000Z',
    });
    const repository = updateRepository(failed);

    await expect(
      new JobsService(repository).update(failed.id, {
        status: JobStatus.PENDING,
      }),
    ).resolves.toMatchObject({
      status: JobStatus.PENDING,
      startedAt: null,
      completedAt: null,
      failureReason: null,
      claimToken: null,
      leaseUntil: null,
    });
  });
});

function updateRepository(current: Job): JobsRepository {
  return {
    update: jest.fn(
      async (_id: string, updater: (job: Readonly<Job>) => Job) =>
        updater(structuredClone(current)),
    ),
  } as unknown as JobsRepository;
}
