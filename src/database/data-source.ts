import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ENV_KEYS } from '../common/constants/env.constants';
import { parseBoolean, parseInteger } from '../common/utils/parser.util';
import { DATABASE_CONSTANTS } from './constants/database.constants';

dotenv.config();

export const dataSourceOptions: DataSourceOptions = {
  type: DATABASE_CONSTANTS.TYPE,
  host: process.env[ENV_KEYS.DB_HOST] || DATABASE_CONSTANTS.DEFAULT_HOST,
  port: parseInteger(process.env[ENV_KEYS.DB_PORT], DATABASE_CONSTANTS.DEFAULT_PORT),
  username: process.env[ENV_KEYS.DB_USERNAME] || DATABASE_CONSTANTS.DEFAULT_USERNAME,
  password: process.env[ENV_KEYS.DB_PASSWORD] || DATABASE_CONSTANTS.DEFAULT_PASSWORD,
  database: process.env[ENV_KEYS.DB_DATABASE] || DATABASE_CONSTANTS.DEFAULT_DATABASE,
  entities: [__dirname + DATABASE_CONSTANTS.ENTITIES_GLOB],
  migrations: [__dirname + DATABASE_CONSTANTS.MIGRATIONS_GLOB],
  synchronize: parseBoolean(process.env[ENV_KEYS.DB_SYNC]),
  logging: parseBoolean(process.env[ENV_KEYS.DB_LOGGING]),
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
