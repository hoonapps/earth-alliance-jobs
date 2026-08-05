import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { SearchJobsQueryDto } from './dto/search-jobs-query.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Job } from './job.model';
import { JobsService } from './jobs.service';

interface DataResponse<T> {
  data: T;
}

interface JobListResponse extends DataResponse<Job[]> {
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  async create(@Body() input: CreateJobDto): Promise<DataResponse<Job>> {
    return { data: await this.jobsService.create(input) };
  }

  @Get()
  async findAll(@Query() query: ListJobsQueryDto): Promise<JobListResponse> {
    return this.toListResponse(await this.jobsService.findAll(query));
  }

  @Get('search')
  async search(@Query() query: SearchJobsQueryDto): Promise<JobListResponse> {
    return this.toListResponse(await this.jobsService.search(query));
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<DataResponse<Job>> {
    return { data: await this.jobsService.findOne(id) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() input: UpdateJobDto,
  ): Promise<DataResponse<Job>> {
    return { data: await this.jobsService.update(id, input) };
  }

  private toListResponse(page: {
    items: Job[];
    total: number;
    page: number;
    limit: number;
  }): JobListResponse {
    return {
      data: page.items,
      meta: {
        page: page.page,
        limit: page.limit,
        total: page.total,
      },
    };
  }
}
