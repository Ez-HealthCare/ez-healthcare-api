import { VisitStatus } from '../../visit/enums/visit-status.enum';

export const DRUG_CLASS_MAP: Record<string, string[]> = {
  penicillin: [
    'amoxicillin',
    'ampicillin',
    'oxacillin',
    'piperacillin',
    'nafcillin',
    'dicloxacillin',
  ],
  sulfa: ['sulfamethoxazole', 'sulfasalazine', 'sulfadiazine', 'sulfacetamide'],
  nsaid: ['aspirin', 'ibuprofen', 'naproxen', 'diclofenac', 'ketorolac', 'piroxicam', 'meloxicam'],
  cephalosporin: ['cefazolin', 'cephalexin', 'ceftriaxone', 'cefepime', 'cefuroxime'],
  fluoroquinolone: ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin'],
};

export const VALID_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  [VisitStatus.HALL_WAITING]: [VisitStatus.RECEPTION_VERIFIED, VisitStatus.CANCELLED],
  [VisitStatus.RECEPTION_VERIFIED]: [VisitStatus.TRIAGE_PENDING, VisitStatus.CANCELLED],
  [VisitStatus.TRIAGE_PENDING]: [VisitStatus.CLINIC_WAITING, VisitStatus.EMERGENCY_DISPATCHED],
  [VisitStatus.CLINIC_WAITING]: [VisitStatus.CLINIC_CALLED, VisitStatus.EMERGENCY_DISPATCHED],
  [VisitStatus.CLINIC_CALLED]: [
    VisitStatus.CLINIC_CALLED,
    VisitStatus.TEMPORARILY_ABSENT,
    VisitStatus.IN_EXAMINATION,
  ],
  [VisitStatus.TEMPORARILY_ABSENT]: [VisitStatus.CLINIC_WAITING],
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
