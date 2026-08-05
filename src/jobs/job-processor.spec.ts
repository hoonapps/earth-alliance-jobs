import { createTestJob } from '../../test/test-job.factory';
import { ClaimedJob, JobStatus } from './job.model';
import { DefaultJobProcessor } from './job-processor';

describe('DefaultJobProcessor', () => {
  const claimedJob = createTestJob({
    status: JobStatus.PROCESSING,
    claimToken: 'claim-token',
    leaseUntil: '2026-08-05T00:01:00.000Z',
  }) as ClaimedJob;
  let previousDelay: string | undefined;

  beforeEach(() => {
    previousDelay = process.env.JOBS_PROCESSING_DELAY_MS;
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (previousDelay === undefined) {
      delete process.env.JOBS_PROCESSING_DELAY_MS;
    } else {
      process.env.JOBS_PROCESSING_DELAY_MS = previousDelay;
    }
    jest.useRealTimers();
  });

  it.each(['0', '-1', 'invalid'])(
    '환경 변수 %s에 대해 유효값 또는 기본 지연으로 처리한다',
    async (delay) => {
      process.env.JOBS_PROCESSING_DELAY_MS = delay;
      const processing = new DefaultJobProcessor().process(claimedJob);

      await jest.runAllTimersAsync();
      await expect(processing).resolves.toBeUndefined();
    },
  );
});
