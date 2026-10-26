import { ConflictException, ForbiddenException } from '@nestjs/common';

export const ClinicalErrorCode = {
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  QUEUE_CLOSED: 'QUEUE_CLOSED',
  ROOM_ACCESS_DENIED: 'ROOM_ACCESS_DENIED',
  ROOM_QUOTA_REACHED: 'ROOM_QUOTA_REACHED',
  TICKET_EXPIRED: 'TICKET_EXPIRED',
  VISIT_STATE_CONFLICT: 'VISIT_STATE_CONFLICT',
  APPOINTMENT_STATE_CONFLICT: 'APPOINTMENT_STATE_CONFLICT',
} as const;

export type ClinicalErrorCode = (typeof ClinicalErrorCode)[keyof typeof ClinicalErrorCode];

export function clinicalConflict(code: ClinicalErrorCode, message: string) {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code, message });
}

export function clinicalForbidden(code: ClinicalErrorCode, message: string) {
  return new ForbiddenException({ statusCode: 403, error: 'Forbidden', code, message });
}
