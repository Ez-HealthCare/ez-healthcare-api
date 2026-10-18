import { ConflictException } from '@nestjs/common';
import { VisitStatus } from './enums/visit-status.enum';

import { VALID_TRANSITIONS } from '../common/constants/visit.constants';

export function assertTransition(currentStatus: VisitStatus, targetStatus: VisitStatus): void {
  const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(targetStatus)) {
    const allowedTargets = allowed.length > 0 ? allowed.join(', ') : 'none';
    throw new ConflictException(
      `Invalid visit status transition from ${currentStatus} to ${targetStatus}. Allowed target statuses: [${allowedTargets}].`,
    );
  }
}
