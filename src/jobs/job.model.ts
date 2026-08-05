export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface Job {
  id: string;
  title: string;
  description: string;
  status: JobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  claimToken: string | null;
  leaseUntil: string | null;
}

export interface ClaimedJob extends Job {
  status: JobStatus.PROCESSING;
  claimToken: string;
  leaseUntil: string;
}

export interface JobPage {
  items: Job[];
  total: number;
  page: number;
  limit: number;
}
