import { Module } from '@nestjs/common';
import { jobsDatabaseProvider } from './jobs.database.provider';
import { JobsController } from './jobs.controller';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';

@Module({
  controllers: [JobsController],
  providers: [jobsDatabaseProvider, JobsRepository, JobsService],
  exports: [JobsRepository, JobsService],
})
export class JobsModule {}
