export const ACCESS_COOKIE = 'ez_access';
export const REFRESH_COOKIE = 'ez_refresh';
export const ACCESS_SECONDS = 15 * 60;
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_SECRET_MIN_LENGTH = 32;
// Development fallback only; production still requires JWT_ACCESS_SECRET.
export const DEV_JWT_SECRET = 'local-development-only-change-this-secret';
export const STAFF_PASSWORD_MIN_LENGTH = 6;
export const BCRYPT_SALT_ROUNDS = 10;
export const ROLES_KEY = 'roles';
export const AUTH_CONTROLLER_PATH = 'auth';
export const AUTH_PATHS = {
  STAFF_LOGIN: 'staff/login',
  REQUEST_OTP: 'patient/request-otp',
  VERIFY_OTP: 'patient/verify-otp',
  REFRESH: 'refresh',
  LOGOUT: 'logout',
  ME: 'me',
} as const;

export const SESSION_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax', path: '/' } as const;
export const OTP_LENGTH = 6;
export const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`);
export const OTP_MIN_VALUE = 10 ** (OTP_LENGTH - 1);
export const OTP_MAX_EXCLUSIVE = 10 ** OTP_LENGTH;
export const OTP_RESEND_SECONDS = 60;
export const OTP_RESEND_DELAY_MS = OTP_RESEND_SECONDS * 1000;
export const OTP_LIFETIME_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_LOCKOUT_MS = 15 * 60_000;
export const OTP_DELIVERY_TIMEOUT_MS = 5000;
export const OTP_DEFAULT_FROM = 'no-reply@ezhealthcare.test';
export const REFRESH_TOKEN_BYTES = 32;
export const REFRESH_TOKEN_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[\w-]{43}$/;
export const SESSION_LIFETIME_MS = 8 * 60 * 60_000;
export const REMEMBERED_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
export const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
export const AUTH_RATE_LIMIT_MAX_REQUESTS = 60;
export const AUTH_RATE_LIMIT_MAX_IPS = 10_000;

export const OTP_LOCKED_MESSAGE = `Too many failed attempts. Try again in ${OTP_LOCKOUT_MS / 60_000} minutes.`;
export const OTP_RESEND_MESSAGE = `Please wait ${OTP_RESEND_SECONDS} seconds before requesting another OTP.`;
