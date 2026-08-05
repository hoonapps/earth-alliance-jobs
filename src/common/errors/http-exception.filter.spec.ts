import { ArgumentsHost, HttpException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const render = (exception: unknown): Record<string, unknown> => {
    let body: Record<string, unknown> = {};
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((value: Record<string, unknown>) => {
        body = value;
      }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: '/test' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(exception, host);
    return body;
  };

  it('예상하지 못한 오류를 내부 정보 없이 500으로 변환한다', () => {
    expect(render(new Error('민감한 내부 오류'))).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
      path: '/test',
    });
  });

  it('문자열 HttpException 응답을 그대로 메시지로 사용한다', () => {
    expect(render(new HttpException('티포트입니다.', 418))).toMatchObject({
      statusCode: 418,
      code: 'I_AM_A_TEAPOT',
      message: '티포트입니다.',
    });
  });

  it('알 수 없는 HTTP 상태와 메시지 형식에 기본값을 사용한다', () => {
    expect(render(new HttpException({}, 499))).toMatchObject({
      statusCode: 499,
      code: 'HTTP_ERROR',
      message: '요청을 처리할 수 없습니다.',
    });
  });
});
