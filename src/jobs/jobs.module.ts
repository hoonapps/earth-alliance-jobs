import { Module } from '@nestjs/common';
import { jobsDatabaseProvider } from './jobs.database.provider';
import { JobsRepository } from './jobs.repository';

@Module({
  providers: [jobsDatabaseProvider, JobsRepository],
  exports: [JobsRepository],
})
export class JobsModule {}
