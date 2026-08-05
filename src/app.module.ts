import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { FileLoggerService } from './common/logging/file-logger.service';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [JobsModule],
  providers: [
    FileLoggerService,
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
