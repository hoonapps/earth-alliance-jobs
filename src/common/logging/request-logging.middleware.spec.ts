import { NextFunction, Request, Response } from 'express';
import { FileLoggerService } from './file-logger.service';
import { RequestLoggingMiddleware } from './request-logging.middleware';

describe('RequestLoggingMiddleware', () => {
  it('로그 파일 쓰기 실패가 요청 흐름에 영향을 주지 않는다', async () => {
    let finish: (() => void) | undefined;
    const logger = {
      write: jest.fn().mockRejectedValue(new Error('log failure')),
    } as unknown as FileLoggerService;
    const request = {
      method: 'GET',
      originalUrl: '/health',
    } as Request;
    const response = {
      statusCode: 200,
      once: jest.fn((event: string, listener: () => void) => {
        expect(event).toBe('finish');
        finish = listener;
      }),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    new RequestLoggingMiddleware(logger).use(request, response, next);
    finish?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.write).toHaveBeenCalledWith(
      'http.request',
      expect.objectContaining({
        method: 'GET',
        path: '/health',
        statusCode: 200,
      }),
    );
  });
});
