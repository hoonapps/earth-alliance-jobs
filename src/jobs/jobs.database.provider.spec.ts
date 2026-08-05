import { JsonDB } from 'node-json-db';
import { jobsDatabaseProvider } from './jobs.database.provider';

describe('jobsDatabaseProvider', () => {
  let previousPath: string | undefined;

  beforeEach(() => {
    previousPath = process.env.JOBS_DB_PATH;
  });

  afterEach(() => {
    if (previousPath === undefined) {
      delete process.env.JOBS_DB_PATH;
    } else {
      process.env.JOBS_DB_PATH = previousPath;
    }
  });

  it('환경 변수 경로로 데이터베이스를 생성한다', () => {
    process.env.JOBS_DB_PATH = '/tmp/configured-jobs.json';
    expect(jobsDatabaseProvider.useFactory()).toBeInstanceOf(JsonDB);
  });

  it('환경 변수가 없으면 프로젝트 jobs.json을 사용한다', () => {
    delete process.env.JOBS_DB_PATH;
    expect(jobsDatabaseProvider.useFactory()).toBeInstanceOf(JsonDB);
  });
});
