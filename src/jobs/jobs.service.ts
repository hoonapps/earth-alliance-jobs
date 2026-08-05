import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { SearchJobsQueryDto } from './dto/search-jobs-query.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Job, JobPage, JobStatus } from './job.model';
import { JobsRepository } from './jobs.repository';

@Injectable()
export class JobsService {
  constructor(private readonly jobsRepository: JobsRepository) {}

  async create(input: CreateJobDto): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      status: JobStatus.PENDING,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      failureReason: null,
      claimToken: null,
      leaseUntil: null,
    };

    return this.jobsRepository.create(job);
  }

  async findAll(query: ListJobsQueryDto): Promise<JobPage> {
    const jobs = await this.jobsRepository.findAll();
    return this.paginate(this.newestFirst(jobs), query.page, query.limit);
  }

  async search(query: SearchJobsQueryDto): Promise<JobPage> {
    if (query.title === undefined && query.status === undefined) {
      throw new BadRequestException({
        code: 'SEARCH_CONDITION_REQUIRED',
        message: 'title 또는 status 검색 조건이 하나 이상 필요합니다.',
      });
    }

    const normalizedTitle = query.title?.toLocaleLowerCase('ko-KR');
    const jobs = await this.jobsRepository.findAll();
    const filtered = jobs.filter((job) => {
      const matchesTitle =
        normalizedTitle === undefined ||
        job.title.toLocaleLowerCase('ko-KR').includes(normalizedTitle);
      const matchesStatus =
        query.status === undefined || job.status === query.status;
      return matchesTitle && matchesStatus;
    });

    return this.paginate(
      this.newestFirst(filtered),
      query.page,
      query.limit,
    );
  }

  async findOne(id: string): Promise<Job> {
    const job = await this.jobsRepository.findById(id);

    if (!job) {
      throw this.notFound(id);
    }

    return job;
  }

  async update(id: string, input: UpdateJobDto): Promise<Job> {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message: '수정할 필드를 하나 이상 전달해야 합니다.',
      });
    }

    const updated = await this.jobsRepository.update(id, (current) => {
      const changesMetadata =
        input.title !== undefined || input.description !== undefined;

      if (changesMetadata && current.status !== JobStatus.PENDING) {
        throw new ConflictException({
          code: 'JOB_NOT_EDITABLE',
          message: '제목과 설명은 pending 상태에서만 수정할 수 있습니다.',
        });
      }

      if (
        input.status !== undefined &&
        input.status !== current.status &&
        !this.isAllowedTransition(current.status, input.status)
      ) {
        throw new ConflictException({
          code: 'INVALID_STATUS_TRANSITION',
          message: `${current.status}에서 ${input.status}(으)로 상태를 변경할 수 없습니다.`,
        });
      }

      const now = new Date().toISOString();
      const next: Job = {
        ...current,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: now,
      };

      if (
        current.status === JobStatus.FAILED &&
        input.status === JobStatus.PENDING
      ) {
        next.startedAt = null;
        next.completedAt = null;
        next.failureReason = null;
        next.claimToken = null;
        next.leaseUntil = null;
      }

      return next;
    });

    if (!updated) {
      throw this.notFound(id);
    }

    return updated;
  }

  private isAllowedTransition(from: JobStatus, to: JobStatus): boolean {
    return (
      (from === JobStatus.PENDING && to === JobStatus.CANCELLED) ||
      (from === JobStatus.FAILED && to === JobStatus.PENDING)
    );
  }

  private paginate(jobs: Job[], page: number, limit: number): JobPage {
    const start = (page - 1) * limit;
    return {
      items: jobs.slice(start, start + limit),
      total: jobs.length,
      page,
      limit,
    };
  }

  private newestFirst(jobs: Job[]): Job[] {
    return jobs.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({
      code: 'JOB_NOT_FOUND',
      message: `작업을 찾을 수 없습니다: ${id}`,
    });
  }
}
