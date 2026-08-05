import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ExceptionBody {
  code?: unknown;
  message?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionBody = this.getExceptionBody(exception);
    const validationMessages = Array.isArray(exceptionBody.message)
      ? exceptionBody.message
      : undefined;

    response.status(status).json({
      statusCode: status,
      code:
        typeof exceptionBody.code === 'string'
          ? exceptionBody.code
          : this.defaultCode(status, validationMessages !== undefined),
      message: validationMessages
        ? '요청 값이 올바르지 않습니다.'
        : this.getMessage(exceptionBody.message, status),
      ...(validationMessages ? { errors: validationMessages } : {}),
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }

  private getExceptionBody(exception: unknown): ExceptionBody {
    if (!(exception instanceof HttpException)) {
      return {};
    }

    const body: unknown = exception.getResponse();
    return typeof body === 'object' && body !== null
      ? (body as ExceptionBody)
      : { message: body };
  }

  private getMessage(message: unknown, status: number): string {
    if (typeof message === 'string') {
      return message;
    }

    return status === HttpStatus.INTERNAL_SERVER_ERROR
      ? '서버 내부 오류가 발생했습니다.'
      : '요청을 처리할 수 없습니다.';
  }

  private defaultCode(status: number, isValidationError: boolean): string {
    if (isValidationError) {
      return 'VALIDATION_ERROR';
    }

    return HttpStatus[status] ?? 'HTTP_ERROR';
  }
}
