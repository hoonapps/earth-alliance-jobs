import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { LoggingModule } from './common/logging/logging.module';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [ScheduleModule.forRoot(), LoggingModule, JobsModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
