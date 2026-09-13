/**
 * Định nghĩa tập trung các keys của biến môi trường (.env)
 * Tránh việc hardcode các chuỗi string rải rác trong mã nguồn
 */
export const ENV_KEYS = {
  PORT: 'PORT',
  NODE_ENV: 'NODE_ENV',

  // Database PostgreSQL
  DB_HOST: 'DB_HOST',
  DB_PORT: 'DB_PORT',
  DB_USERNAME: 'DB_USERNAME',
  DB_PASSWORD: 'DB_PASSWORD',
  DB_DATABASE: 'DB_DATABASE',
  DB_SYNC: 'DB_SYNC',
  DB_LOGGING: 'DB_LOGGING',

  // JWT Authentication
  JWT_ACCESS_SECRET: 'JWT_ACCESS_SECRET',
  JWT_ACCESS_EXPIRATION: 'JWT_ACCESS_EXPIRATION',
  JWT_REFRESH_SECRET: 'JWT_REFRESH_SECRET',
  JWT_REFRESH_EXPIRATION: 'JWT_REFRESH_EXPIRATION',

  // CORS & Client
  FRONTEND_URL: 'FRONTEND_URL',

  // Seed Data (Optional Override)
  SEED_ADMIN_EMAIL: 'SEED_ADMIN_EMAIL',
  SEED_ADMIN_PASSWORD: 'SEED_ADMIN_PASSWORD',

  // Nest Observe
  OBSERVE_APP_KEY: 'OBSERVE_APP_KEY',
  OBSERVE_APP_SECRET: 'OBSERVE_APP_SECRET',
} as const;

export type EnvKey = (typeof ENV_KEYS)[keyof typeof ENV_KEYS];
