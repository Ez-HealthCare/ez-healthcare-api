/**
 * Các hằng số cấu hình chung của toàn bộ ứng dụng API
 */
export const APP_CONSTANTS = {
  DEFAULT_PORT: 3000,
  GLOBAL_PREFIX: 'api',
  SWAGGER_DOCS_PATH: 'api/docs',
  SWAGGER_TITLE: 'Ez-HealthCare API',
  SWAGGER_DESCRIPTION: 'Hệ thống RESTful API cho nền tảng quản lý chăm sóc sức khỏe Ez-HealthCare',
  SWAGGER_VERSION: '1.0',

  ENV_DEVELOPMENT: 'development',
  ENV_PRODUCTION: 'production',
  ENV_TEST: 'test',

  // Observe Defaults
  OBSERVE_DEFAULT_APP_KEY: 'DEFAULT_APP_KEY',
  OBSERVE_DEFAULT_APP_SECRET: 'DEFAULT_APP_SECRET',
} as const;
