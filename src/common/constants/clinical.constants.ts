export const DEPARTMENT_CODES = {
  EMERGENCY: 'P.001',
  RECEPTION: 'P.101',
  GENERAL_MEDICINE: 'P.102',
  CARDIOLOGY: 'P.103',
  ULTRASOUND: 'P.104',
  PULMONOLOGY: 'P.105',
  NEPHROLOGY: 'P.106',
  GERIATRICS: 'P.107',
  SURGERY: 'P.108',
  BLOOD_LAB: 'P.201',
  URINALYSIS: 'P.203',
  CHEST_XRAY: 'P.302',
} as const;

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const ELDERLY_PRIORITY_AGE = 80;
export const MAX_PATIENT_HALL_REISSUES = 1;
export const MAX_QUEUE_CALL_ATTEMPTS = 3;
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const BUSINESS_WINDOWS = [{ start: '00:00', end: '24:00' }] as const;
export const QUEUE_PRIORITY_CONFIG_KEY = 'BR-QUEUE-PRIORITY';
export const QUEUE_PRIORITY_DEFAULTS = {
  alphaWaitWeight: 0.7,
  betaDistanceWeight: 0.3,
  autoPriorityRecall: true,
} as const;
