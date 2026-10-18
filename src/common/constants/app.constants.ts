export const API_PREFIX = 'api';
export const SWAGGER_PATH = `${API_PREFIX}/docs`;
export const DEFAULT_API_PORT = 3000;
export const DEFAULT_WEB_ORIGIN = 'http://localhost:3001';
// Existing fallback retained; deployments should configure SIGNATURE_SECRET.
export const DEV_SIGNATURE_SECRET = 'ez-healthcare-dev-key';

// Local development defaults, not production credentials.
export const DATABASE_DEFAULTS = {
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'postgres',
  database: 'tlcn_api_db',
} as const;
