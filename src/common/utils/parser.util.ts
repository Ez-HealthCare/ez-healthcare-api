/**
 * Các tiện ích parse giá trị từ biến môi trường (string) sang kiểu dữ liệu tương ứng
 */

/**
 * Chuyển chuỗi hoặc boolean sang boolean một cách an toàn.
 * Trả về true nếu giá trị là true hoặc chuỗi 'true' / '1' (không phân biệt hoa thường).
 */
export function parseBoolean(value?: string | boolean | null): boolean {
  if (typeof value === 'boolean') return value;
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

/**
 * Chuyển chuỗi hoặc number sang số nguyên an toàn với giá trị fallback.
 */
export function parseInteger(value?: string | number | null, defaultValue = 0, radix = 10): number {
  if (typeof value === 'number') return value;
  if (!value) return defaultValue;
  const parsed = parseInt(value.trim(), radix);
  return isNaN(parsed) ? defaultValue : parsed;
}
