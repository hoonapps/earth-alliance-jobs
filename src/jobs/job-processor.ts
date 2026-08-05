import { Injectable } from '@nestjs/common';
import { setTimeout } from 'node:timers/promises';
import { DEFAULT_JOB_PROCESSING_DELAY_MS } from './jobs.constants';
import { ClaimedJob } from './job.model';

export const JOB_PROCESSOR = Symbol('JOB_PROCESSOR');

export interface JobProcessor {
  process(job: ClaimedJob): Promise<void>;
}

@Injectable()
export class DefaultJobProcessor implements JobProcessor {
  async process(_job: ClaimedJob): Promise<void> {
    const delayMs = this.positiveInteger(
      process.env.JOBS_PROCESSING_DELAY_MS,
      DEFAULT_JOB_PROCESSING_DELAY_MS,
    );

    // 과제에는 실제 도메인 작업이 없으므로 비동기 처리 경계만 모사한다.
    await setTimeout(delayMs);
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
