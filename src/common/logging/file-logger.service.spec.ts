import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLoggerService } from './file-logger.service';

describe('FileLoggerService', () => {
  let directory: string;
  let previousLogPath: string | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'file-logger-'));
    previousLogPath = process.env.LOG_FILE_PATH;
  });

  afterEach(async () => {
    if (previousLogPath === undefined) {
      delete process.env.LOG_FILE_PATH;
    } else {
      process.env.LOG_FILE_PATH = previousLogPath;
    }
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('기본 경로와 기본 context로 로그를 기록하고 종료 시 flush한다', async () => {
    delete process.env.LOG_FILE_PATH;
    jest.spyOn(process, 'cwd').mockReturnValue(directory);
    const logger = new FileLoggerService();

    await logger.write('default-context');
    await logger.onApplicationShutdown();

    const entry = JSON.parse(
      await readFile(join(directory, 'logs.txt'), 'utf8'),
    ) as Record<string, unknown>;
    expect(entry.event).toBe('default-context');
  });

  it('앞선 쓰기 실패를 격리하고 다음 로그를 계속 기록한다', async () => {
    const missingDirectory = join(directory, 'created-later');
    process.env.LOG_FILE_PATH = join(missingDirectory, 'logs.txt');
    const logger = new FileLoggerService();

    await expect(logger.write('first')).rejects.toBeDefined();
    await mkdir(missingDirectory);
    await expect(logger.write('second', { sequence: 2 })).resolves.toBeUndefined();

    const entry = JSON.parse(
      await readFile(join(missingDirectory, 'logs.txt'), 'utf8'),
    ) as Record<string, unknown>;
    expect(entry).toMatchObject({ event: 'second', sequence: 2 });
  });

  it('종료 시 남은 로그 쓰기 실패를 외부로 전파하지 않는다', async () => {
    process.env.LOG_FILE_PATH = join(directory, 'missing', 'logs.txt');
    const logger = new FileLoggerService();

    await expect(logger.write('failure')).rejects.toBeDefined();
    await expect(logger.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
