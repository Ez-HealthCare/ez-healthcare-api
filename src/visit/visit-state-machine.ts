import { ConflictException } from '@nestjs/common';
import { VisitStatus } from './enums/visit-status.enum';

export const VALID_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  [VisitStatus.HALL_WAITING]: [VisitStatus.RECEPTION_VERIFIED, VisitStatus.CANCELLED],
  [VisitStatus.RECEPTION_VERIFIED]: [VisitStatus.TRIAGE_PENDING, VisitStatus.CANCELLED],
  [VisitStatus.TRIAGE_PENDING]: [VisitStatus.CLINIC_WAITING, VisitStatus.EMERGENCY_DISPATCHED],
  [VisitStatus.CLINIC_WAITING]: [VisitStatus.IN_EXAMINATION, VisitStatus.EMERGENCY_DISPATCHED],
  [VisitStatus.IN_EXAMINATION]: [
    VisitStatus.PARACLINICAL_PENDING,
    VisitStatus.CLINIC_WAITING,
    VisitStatus.COMPLETED,
    VisitStatus.EMERGENCY_DISPATCHED,
  ],
  [VisitStatus.PARACLINICAL_PENDING]: [
    VisitStatus.RE_EXAM_CALLING,
    VisitStatus.EMERGENCY_DISPATCHED,
  ],
  [VisitStatus.RE_EXAM_CALLING]: [VisitStatus.IN_EXAMINATION],
  [VisitStatus.COMPLETED]: [],
  [VisitStatus.EMERGENCY_DISPATCHED]: [],
  [VisitStatus.CANCELLED]: [],
};

export function assertTransition(currentStatus: VisitStatus, targetStatus: VisitStatus): void {
  const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(targetStatus)) {
    const allowedTargets = allowed.length > 0 ? allowed.join(', ') : 'none';
    throw new ConflictException(
      `Invalid visit status transition from ${currentStatus} to ${targetStatus}. Allowed target statuses: [${allowedTargets}].`,
    );
  }
}
