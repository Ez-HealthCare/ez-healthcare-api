import { ConflictException } from '@nestjs/common';
import { VisitStatus } from './enums/visit-status.enum';
import { assertTransition, VALID_TRANSITIONS } from './visit-state-machine';

describe('Visit State Machine (assertTransition)', () => {
  // Independent valid transition pairs specified according to outpatient clinical workflow rules
  const INDEPENDENT_VALID_TRANSITIONS: ReadonlyArray<[VisitStatus, VisitStatus]> = [
    // HALL_WAITING
    [VisitStatus.HALL_WAITING, VisitStatus.RECEPTION_VERIFIED],
    [VisitStatus.HALL_WAITING, VisitStatus.CANCELLED],

    // RECEPTION_VERIFIED
    [VisitStatus.RECEPTION_VERIFIED, VisitStatus.TRIAGE_PENDING],
    [VisitStatus.RECEPTION_VERIFIED, VisitStatus.CANCELLED],

    // TRIAGE_PENDING
    [VisitStatus.TRIAGE_PENDING, VisitStatus.CLINIC_WAITING],
    [VisitStatus.TRIAGE_PENDING, VisitStatus.EMERGENCY_DISPATCHED],

    // CLINIC_WAITING
    [VisitStatus.CLINIC_WAITING, VisitStatus.IN_EXAMINATION],
    [VisitStatus.CLINIC_WAITING, VisitStatus.EMERGENCY_DISPATCHED],

    // IN_EXAMINATION
    [VisitStatus.IN_EXAMINATION, VisitStatus.PARACLINICAL_PENDING],
    [VisitStatus.IN_EXAMINATION, VisitStatus.CLINIC_WAITING],
    [VisitStatus.IN_EXAMINATION, VisitStatus.COMPLETED],
    [VisitStatus.IN_EXAMINATION, VisitStatus.EMERGENCY_DISPATCHED],

    // PARACLINICAL_PENDING
    [VisitStatus.PARACLINICAL_PENDING, VisitStatus.RE_EXAM_CALLING],
    [VisitStatus.PARACLINICAL_PENDING, VisitStatus.EMERGENCY_DISPATCHED],

    // RE_EXAM_CALLING
    [VisitStatus.RE_EXAM_CALLING, VisitStatus.IN_EXAMINATION],
  ];

  const ALL_STATUSES = Object.values(VisitStatus);

  const validPairKeySet = new Set(
    INDEPENDENT_VALID_TRANSITIONS.map(([current, target]) => `${current}->${target}`),
  );

  // Derive all remaining current/target pairs as invalid
  const ALL_INVALID_TRANSITIONS: [VisitStatus, VisitStatus][] = [];
  for (const current of ALL_STATUSES) {
    for (const target of ALL_STATUSES) {
      if (!validPairKeySet.has(`${current}->${target}`)) {
        ALL_INVALID_TRANSITIONS.push([current, target]);
      }
    }
  }

  describe('Transition Matrix Integrity', () => {
    it('should have exactly 15 valid pairs and 85 invalid pairs across all 10 statuses', () => {
      expect(ALL_STATUSES).toHaveLength(10);
      expect(INDEPENDENT_VALID_TRANSITIONS).toHaveLength(15);
      expect(ALL_INVALID_TRANSITIONS).toHaveLength(85);
      expect(INDEPENDENT_VALID_TRANSITIONS.length + ALL_INVALID_TRANSITIONS.length).toBe(100);
    });

    it('should match the source VALID_TRANSITIONS configuration exactly', () => {
      for (const [current, target] of INDEPENDENT_VALID_TRANSITIONS) {
        expect(VALID_TRANSITIONS[current]).toContain(target);
      }
      let sourceValidCount = 0;
      for (const status of ALL_STATUSES) {
        sourceValidCount += (VALID_TRANSITIONS[status] ?? []).length;
      }
      expect(sourceValidCount).toBe(INDEPENDENT_VALID_TRANSITIONS.length);
    });
  });

  describe('Valid Transitions (Happy Path)', () => {
    test.each(INDEPENDENT_VALID_TRANSITIONS)(
      'permits valid transition from %s to %s without throwing',
      (current, target) => {
        expect(() => assertTransition(current, target)).not.toThrow();
      },
    );
  });

  describe('Invalid Transitions (Exhaustive & ConflictException)', () => {
    test.each(ALL_INVALID_TRANSITIONS)(
      'rejects invalid transition from %s to %s with ConflictException',
      (current, target) => {
        expect(() => assertTransition(current, target)).toThrow(ConflictException);
      },
    );
  });

  describe('Exception Message Formatting', () => {
    it('formats message with current, target, and allowed targets for non-terminal state', () => {
      expect(() => assertTransition(VisitStatus.HALL_WAITING, VisitStatus.IN_EXAMINATION)).toThrow(
        'Invalid visit status transition from HALL_WAITING to IN_EXAMINATION. Allowed target statuses: [RECEPTION_VERIFIED, CANCELLED].',
      );
    });

    it('formats message with [none] allowed targets for terminal state mutation', () => {
      expect(() => assertTransition(VisitStatus.COMPLETED, VisitStatus.IN_EXAMINATION)).toThrow(
        'Invalid visit status transition from COMPLETED to IN_EXAMINATION. Allowed target statuses: [none].',
      );
    });
  });
});
