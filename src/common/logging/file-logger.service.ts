import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export type LogContext = Record<string, unknown>;

@Injectable()
export class FileLoggerService implements OnApplicationShutdown {
  private pendingWrite: Promise<void> = Promise.resolve();
  private readonly filename =
    process.env.LOG_FILE_PATH ?? join(process.cwd(), 'logs.txt');

  write(event: string, context: LogContext = {}): Promise<void> {
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...context,
    })}\n`;

    const write = this.pendingWrite
      .catch(() => undefined)
      .then(() => appendFile(this.filename, line, 'utf8'));

    this.pendingWrite = write;
    return write;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pendingWrite.catch(() => undefined);
  }
}
