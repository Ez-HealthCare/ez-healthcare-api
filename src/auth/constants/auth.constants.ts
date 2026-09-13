/**
 * Các hằng số riêng cho phân hệ Xác thực (Auth Module)
 */
export const AUTH_CONSTANTS = {
  // Password hashing
  BCRYPT_SALT_ROUNDS: 10,

  // JWT Default Expirations
  DEFAULT_JWT_ACCESS_EXPIRATION: '15m',
  DEFAULT_JWT_REFRESH_EXPIRATION: '7d',
  REFRESH_TOKEN_VALIDITY_DAYS: 7,

  // JWT Strategy & Hashing
  STRATEGY_JWT: 'jwt',
  HASH_ALGORITHM: 'sha256',
  HASH_ENCODING: 'hex',

  // Default Dev Secrets (được dùng làm fallback an toàn trong môi trường development)
  DEFAULT_JWT_ACCESS_SECRET: 'dev_jwt_access_super_secret_ez_healthcare_2026',
  DEFAULT_JWT_REFRESH_SECRET: 'dev_jwt_refresh_super_secret_ez_healthcare_2026',

  // Thông báo lỗi chuẩn
  ERRORS: {
    INVALID_CREDENTIALS: 'Email hoặc mật khẩu không chính xác.',
    ACCOUNT_INACTIVE: 'Tài khoản đã bị vô hiệu hoá.',
    INVALID_REFRESH_TOKEN: 'Refresh token không hợp lệ hoặc đã hết hạn.',
    TOKEN_NOT_FOUND: 'Refresh token không tồn tại.',
    TOKEN_EXPIRED: 'Refresh token đã hết hạn. Vui lòng đăng nhập lại.',
    REUSE_DETECTED:
      'Phát hiện tái sử dụng Refresh Token! Toàn bộ phiên đăng nhập đã bị thu hồi vì lý do bảo mật. Vui lòng đăng nhập lại.',
    USER_NOT_FOUND: 'Người dùng không tồn tại hoặc đã bị vô hiệu hoá.',
  },

  MESSAGES: {
    LOGOUT_SUCCESS: 'Đăng xuất thành công.',
  },
} as const;
