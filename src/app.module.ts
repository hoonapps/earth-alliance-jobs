import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { LoggingModule } from './common/logging/logging.module';
import { RequestLoggingMiddleware } from './common/logging/request-logging.middleware';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [ScheduleModule.forRoot(), LoggingModule, JobsModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes({
      path: '{*splat}',
      method: RequestMethod.ALL,
    });
  }
}
