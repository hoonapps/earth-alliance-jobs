import { join } from 'node:path';
import { Config, JsonDB } from 'node-json-db';
import { JOBS_DATABASE } from './jobs.constants';

export const jobsDatabaseProvider = {
  provide: JOBS_DATABASE,
  useFactory: (): JsonDB => {
    const filename = process.env.JOBS_DB_PATH ?? join(process.cwd(), 'jobs.json');

    // saveOnPush와 fsync를 활성화해 변경마다 디스크에 반영한다.
    return new JsonDB(new Config(filename, true, true, '/', true));
  },
};
