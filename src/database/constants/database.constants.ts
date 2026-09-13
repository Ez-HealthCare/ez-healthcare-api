/**
 * Các hằng số cấu hình cơ sở dữ liệu TypeORM và kết nối PostgreSQL
 */
export const DATABASE_CONSTANTS = {
  TYPE: 'postgres' as const,
  DEFAULT_HOST: 'localhost',
  DEFAULT_PORT: 5432,
  DEFAULT_USERNAME: 'postgres',
  DEFAULT_PASSWORD: 'postgres',
  DEFAULT_DATABASE: 'tlcn_api_db',

  // Pattern đường dẫn tìm kiếm entities và migrations
  ENTITIES_GLOB: '/../**/*.entity{.ts,.js}',
  MIGRATIONS_GLOB: '/migrations/*{.ts,.js}',

  // Giá trị mặc định cho synchronize và logging
  DEFAULT_SYNC: false,
  DEFAULT_LOGGING: false,
} as const;
