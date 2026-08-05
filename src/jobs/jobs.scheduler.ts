import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { FileLoggerService } from '../common/logging/file-logger.service';
import { JOB_PROCESSOR, JobProcessor } from './job-processor';
import {
  DEFAULT_JOB_BATCH_SIZE,
  DEFAULT_JOB_INTERVAL_MS,
  DEFAULT_JOB_LEASE_MS,
} from './jobs.constants';
import { ClaimedJob } from './job.model';
import { JobsRepository } from './jobs.repository';

export interface JobRunSummary {
  claimed: number;
  completed: number;
  failed: number;
  stale: number;
  skipped: boolean;
}

const intervalFromEnvironment = positiveInteger(
  process.env.JOBS_INTERVAL_MS,
  DEFAULT_JOB_INTERVAL_MS,
);

@Injectable()
export class JobsScheduler {
  private running = false;
  private readonly batchSize = positiveInteger(
    process.env.JOBS_BATCH_SIZE,
    DEFAULT_JOB_BATCH_SIZE,
  );
  private readonly leaseMs = positiveInteger(
    process.env.JOBS_LEASE_MS,
    DEFAULT_JOB_LEASE_MS,
  );

  constructor(
    private readonly jobsRepository: JobsRepository,
    @Inject(JOB_PROCESSOR) private readonly processor: JobProcessor,
    private readonly logger: FileLoggerService,
  ) {}

  @Interval('jobs-processing', intervalFromEnvironment)
  async handleInterval(): Promise<void> {
    if (process.env.JOBS_SCHEDULER_ENABLED === 'false') {
      return;
    }

    await this.runOnce();
  }

  async runOnce(): Promise<JobRunSummary> {
    if (this.running) {
      await this.safeLog('scheduler.skipped', {
        reason: 'previous_run_in_progress',
      });
      return this.emptySummary(true);
    }

    this.running = true;
    const summary = this.emptySummary(false);

    try {
      await this.safeLog('scheduler.started', {
        batchSize: this.batchSize,
      });

      const jobs = await this.jobsRepository.claimPending(
        this.batchSize,
        new Date(),
        this.leaseMs,
      );
      summary.claimed = jobs.length;

      for (const job of jobs) {
        await this.processOne(job, summary);
      }

      return summary;
    } catch (error) {
      await this.safeLog('scheduler.failed', {
        error: this.errorMessage(error),
      });
      throw error;
    } finally {
      await this.safeLog('scheduler.finished', {
        claimed: summary.claimed,
        completed: summary.completed,
        failed: summary.failed,
        stale: summary.stale,
      });
      this.running = false;
    }
  }

  private async processOne(
    job: ClaimedJob,
    summary: JobRunSummary,
  ): Promise<void> {
    await this.safeLog('job.claimed', {
      jobId: job.id,
      attempt: job.attempts,
    });

    try {
      await this.processor.process(job);
      const settled = await this.jobsRepository.markCompleted(
        job.id,
        job.claimToken,
        new Date(),
      );

      if (!settled) {
        summary.stale += 1;
        await this.safeLog('job.settlement_skipped', {
          jobId: job.id,
          reason: 'stale_claim',
        });
        return;
      }

      summary.completed += 1;
      await this.safeLog('job.completed', {
        jobId: job.id,
        attempt: job.attempts,
      });
    } catch (error) {
      const reason = this.errorMessage(error);
      const settled = await this.jobsRepository.markFailed(
        job.id,
        job.claimToken,
        new Date(),
        reason,
      );

      if (!settled) {
        summary.stale += 1;
        await this.safeLog('job.settlement_skipped', {
          jobId: job.id,
          reason: 'stale_claim',
        });
        return;
      }

      summary.failed += 1;
      await this.safeLog('job.failed', {
        jobId: job.id,
        attempt: job.attempts,
        error: reason,
      });
    }
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 500);
  }

  private async safeLog(
    event: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await this.logger.write(event, context).catch(() => undefined);
  }

  private emptySummary(skipped: boolean): JobRunSummary {
    return {
      claimed: 0,
      completed: 0,
      failed: 0,
      stale: 0,
      skipped,
    };
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
