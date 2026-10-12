/**
 * National Early Warning Score 2 (NEWS2) Calculator
 *
 * CLINICAL SPECIFICATION & LIMITATIONS:
 * This calculator is strictly limited to the five measured physiological parameters
 * captured during nurse vital triage:
 * 1. Respiration Rate (breaths/min)
 * 2. Oxygen Saturation (SpO2, Scale 1)
 * 3. Systolic Blood Pressure (mmHg)
 * 4. Pulse / Heart Rate (bpm)
 * 5. Body Temperature (°C)
 *
 * EXCLUSIONS & SCOPE LIMITATIONS:
 * - Oxygen Therapy (Air vs Supplemental O2): Royal College of Physicians (RCP) NEWS2 adds
 *   +2 points if patient is receiving supplemental oxygen. In this outpatient triage workflow,
 *   this parameter is not recorded and thus excluded (assumed room air / 0 points).
 * - Level of Consciousness (ACVPU): RCP NEWS2 adds +3 points for new-onset confusion or
 *   reduced consciousness (Voice, Pain, Unresponsive). In this outpatient vital intake,
 *   neurological response is not quantified and thus excluded (assumed Alert / 0 points).
 * - SpO2 Scale 2: Used specifically for patients with confirmed hypercapnic respiratory failure
 *   (target range 88-92%). This implementation uses standard Scale 1.
 */

export type News2Risk = 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH';

export interface News2Input {
  respiratoryRate: number;
  spo2: number;
  bloodPressureSystolic: number;
  heartRate: number;
  temperature: number;
}

export interface News2Components {
  respiratoryRate: number;
  spo2: number;
  bloodPressureSystolic: number;
  heartRate: number;
  temperature: number;
}

export interface News2Result {
  score: number;
  risk: News2Risk;
  components: News2Components;
}

/**
 * Respiration rate scoring (breaths/min):
 * <= 8: 3
 * 9 - 11: 1
 * 12 - 20: 0
 * 21 - 24: 2
 * >= 25: 3
 */
export function scoreRespiratoryRate(rate: number): number {
  if (rate <= 8) return 3;
  if (rate <= 11) return 1;
  if (rate <= 20) return 0;
  if (rate <= 24) return 2;
  return 3;
}

/**
 * SpO2 Scale 1 scoring (%):
 * <= 91: 3
 * 92 - 93: 2
 * 94 - 95: 1
 * >= 96: 0
 */
export function scoreSpo2Scale1(spo2: number): number {
  if (spo2 <= 91) return 3;
  if (spo2 <= 93) return 2;
  if (spo2 <= 95) return 1;
  return 0;
}

/**
 * Systolic blood pressure scoring (mmHg):
 * <= 90: 3
 * 91 - 100: 2
 * 101 - 110: 1
 * 111 - 219: 0
 * >= 220: 3
 */
export function scoreBloodPressureSystolic(systolic: number): number {
  if (systolic <= 90) return 3;
  if (systolic <= 100) return 2;
  if (systolic <= 110) return 1;
  if (systolic < 220) return 0;
  return 3;
}

/**
 * Pulse / Heart rate scoring (bpm):
 * <= 40: 3
 * 41 - 50: 1
 * 51 - 90: 0
 * 91 - 110: 1
 * 111 - 130: 2
 * >= 131: 3
 */
export function scoreHeartRate(rate: number): number {
  if (rate <= 40) return 3;
  if (rate <= 50) return 1;
  if (rate <= 90) return 0;
  if (rate <= 110) return 1;
  if (rate <= 130) return 2;
  return 3;
}

/**
 * Body temperature scoring (°C):
 * <= 35.0: 3
 * 35.1 - 36.0: 1
 * 36.1 - 38.0: 0
 * 38.1 - 39.0: 1
 * >= 39.1: 2
 */
export function scoreTemperature(temp: number): number {
  if (temp <= 35.0) return 3;
  if (temp <= 36.0) return 1;
  if (temp <= 38.0) return 0;
  if (temp <= 39.0) return 1;
  return 2;
}

/**
 * Pure NEWS2 score calculator.
 *
 * Standard Clinical Risk Thresholds (with single-parameter red trigger rule):
 * - Aggregate score >= 7: HIGH clinical risk (urgent clinical review & emergency response)
 * - Aggregate score >= 5 OR any single parameter score of 3: MEDIUM clinical risk (urgent ward-based response)
 * - Aggregate score 1 - 4: LOW_MEDIUM clinical risk (ward-based response)
 * - Aggregate score 0: LOW clinical risk (routine monitoring)
 */
export function calculateNews2(input: News2Input): News2Result {
  const components: News2Components = {
    respiratoryRate: scoreRespiratoryRate(input.respiratoryRate),
    spo2: scoreSpo2Scale1(input.spo2),
    bloodPressureSystolic: scoreBloodPressureSystolic(input.bloodPressureSystolic),
    heartRate: scoreHeartRate(input.heartRate),
    temperature: scoreTemperature(input.temperature),
  };

  const score =
    components.respiratoryRate +
    components.spo2 +
    components.bloodPressureSystolic +
    components.heartRate +
    components.temperature;

  const hasScore3 =
    components.respiratoryRate === 3 ||
    components.spo2 === 3 ||
    components.bloodPressureSystolic === 3 ||
    components.heartRate === 3 ||
    components.temperature === 3;

  let risk: News2Risk;
  if (score >= 7) {
    risk = 'HIGH';
  } else if (score >= 5 || hasScore3) {
    risk = 'MEDIUM';
  } else if (score >= 1) {
    risk = 'LOW_MEDIUM';
  } else {
    risk = 'LOW';
  }

  return { score, risk, components };
}
