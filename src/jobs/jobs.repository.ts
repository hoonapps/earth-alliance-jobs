import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import { JsonDB } from 'node-json-db';
import { JOBS_DATABASE } from './jobs.constants';
import { ClaimedJob, Job, JobStatus } from './job.model';

type JobUpdater = (current: Readonly<Job>) => Job;

@Injectable()
export class JobsRepository implements OnModuleInit {
  private readonly mutex = new Mutex();

  constructor(@Inject(JOBS_DATABASE) private readonly database: JsonDB) {}

  async onModuleInit(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (!(await this.database.exists('/jobs'))) {
        await this.database.push('/jobs', [], true);
      }

      await this.readJobsUnsafe();
    });
  }

  async findAll(): Promise<Job[]> {
    return this.mutex.runExclusive(async () => {
      const jobs = await this.readJobsUnsafe();
      return this.clone(jobs);
    });
  }

  async findById(id: string): Promise<Job | undefined> {
    return this.mutex.runExclusive(async () => {
      const jobs = await this.readJobsUnsafe();
      const job = jobs.find((item) => item.id === id);
      return job ? this.clone(job) : undefined;
    });
  }

  async create(job: Job): Promise<Job> {
    return this.mutex.runExclusive(async () => {
      const jobs = await this.readJobsUnsafe();
      jobs.push(this.clone(job));
      await this.writeJobsUnsafe(jobs);
      return this.clone(job);
    });
  }

  async update(id: string, updater: JobUpdater): Promise<Job | undefined> {
    return this.mutex.runExclusive(async () => {
      const jobs = await this.readJobsUnsafe();
      const index = jobs.findIndex((job) => job.id === id);

      if (index === -1) {
        return undefined;
      }

      const updated = updater(this.clone(jobs[index]));
      jobs[index] = this.clone(updated);
      await this.writeJobsUnsafe(jobs);
      return this.clone(updated);
    });
  }

  async claimPending(
    limit: number,
    now: Date,
    leaseMs: number,
  ): Promise<ClaimedJob[]> {
    return this.mutex.runExclusive(async () => {
      const jobs = await this.readJobsUnsafe();
      const nowIso = now.toISOString();

      // 처리 Pod가 사라진 경우를 대비해 lease가 만료된 작업은 재선점 가능하게 한다.
      for (const job of jobs) {
        if (
          job.status === JobStatus.PROCESSING &&
          job.leaseUntil !== null &&
          job.leaseUntil <= nowIso
        ) {
          job.status = JobStatus.PENDING;
          job.claimToken = null;
          job.leaseUntil = null;
          job.updatedAt = nowIso;
        }
      }

      const targets = jobs
        .filter((job) => job.status === JobStatus.PENDING)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit);

      const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
      const claimed: ClaimedJob[] = targets.map((job) => {
        const claimToken = randomUUID();
        Object.assign(job, {
          status: JobStatus.PROCESSING,
          attempts: job.attempts + 1,
          startedAt: nowIso,
          updatedAt: nowIso,
          completedAt: null,
          failureReason: null,
          claimToken,
          leaseUntil,
        });

        return this.clone(job) as ClaimedJob;
      });

      if (claimed.length > 0) {
        await this.writeJobsUnsafe(jobs);
      }

      return claimed;
    });
  }

  async markCompleted(
    id: string,
    claimToken: string,
    now: Date,
  ): Promise<boolean> {
    return this.settleClaim(id, claimToken, now, JobStatus.COMPLETED);
  }

  async markFailed(
    id: string,
    claimToken: string,
    now: Date,
    failureReason: string,
  ): Promise<boolean> {
    return this.settleClaim(
      id,
      claimToken,
      now,
      JobStatus.FAILED,
      failureReason,
    );
  }

  private async settleClaim(
    id: string,
    claimToken: string,
    now: Date,
    status: JobStatus.COMPLETED | JobStatus.FAILED,
    failureReason: string | null = null,
  ): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const jobs = await this.readJobsUnsafe();
      const job = jobs.find((item) => item.id === id);

      // 만료 후 다른 실행자가 재선점한 작업을 이전 실행자가 덮어쓰지 못하게 한다.
      if (
        !job ||
        job.status !== JobStatus.PROCESSING ||
        job.claimToken !== claimToken
      ) {
        return false;
      }

      const nowIso = now.toISOString();
      job.status = status;
      job.updatedAt = nowIso;
      job.completedAt = status === JobStatus.COMPLETED ? nowIso : null;
      job.failureReason = failureReason;
      job.claimToken = null;
      job.leaseUntil = null;

      await this.writeJobsUnsafe(jobs);
      return true;
    });
  }

  private async readJobsUnsafe(): Promise<Job[]> {
    const jobs = await this.database.getObject<unknown>('/jobs');

    if (!Array.isArray(jobs)) {
      throw new Error('jobs.json의 /jobs 값은 배열이어야 합니다.');
    }

    return jobs as Job[];
  }

  private async writeJobsUnsafe(jobs: Job[]): Promise<void> {
    await this.database.push('/jobs', jobs, true);
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
