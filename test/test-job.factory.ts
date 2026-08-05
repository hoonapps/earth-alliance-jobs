import { randomUUID } from 'node:crypto';
import { Job, JobStatus } from '../src/jobs/job.model';

export function createTestJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: '테스트 작업',
    description: '테스트 설명',
    status: JobStatus.PENDING,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    failureReason: null,
    claimToken: null,
    leaseUntil: null,
    ...overrides,
  };
}
