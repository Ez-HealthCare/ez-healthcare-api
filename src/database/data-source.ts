import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ApiConfigService } from '../config/api-config.service';

const config = ApiConfigService.fromEnvironment();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const dataSourceOptions: DataSourceOptions = {
  ...config.database,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTransactionMode: 'each',
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
