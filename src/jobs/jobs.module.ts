import { Module } from '@nestjs/common';
import { DefaultJobProcessor, JOB_PROCESSOR } from './job-processor';
import { jobsDatabaseProvider } from './jobs.database.provider';
import { JobsController } from './jobs.controller';
import { JobsRepository } from './jobs.repository';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';

@Module({
  controllers: [JobsController],
  providers: [
    jobsDatabaseProvider,
    JobsRepository,
    JobsService,
    JobsScheduler,
    DefaultJobProcessor,
    {
      provide: JOB_PROCESSOR,
      useExisting: DefaultJobProcessor,
    },
  ],
  exports: [JobsRepository, JobsService, JobsScheduler, JOB_PROCESSOR],
})
export class JobsModule {}
