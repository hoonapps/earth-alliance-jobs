import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { FileLoggerService } from './file-logger.service';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: FileLoggerService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      void this.logger
        .write('http.request', {
          method: request.method,
          path: request.originalUrl,
          statusCode: response.statusCode,
          durationMs: Number(durationMs.toFixed(2)),
        })
        .catch(() => undefined);
    });

    next();
  }
}
