import {
  calculateNews2,
  scoreBloodPressureSystolic,
  scoreHeartRate,
  scoreRespiratoryRate,
  scoreSpo2Scale1,
  scoreTemperature,
} from './news2-calculator';

describe('NEWS2 Calculator', () => {
  describe('Individual Component Scoring (Documented Thresholds & Boundaries)', () => {
    describe('scoreRespiratoryRate', () => {
      test.each([
        { rate: 8, expected: 3 },
        { rate: 9, expected: 1 },
        { rate: 11, expected: 1 },
        { rate: 12, expected: 0 },
        { rate: 20, expected: 0 },
        { rate: 21, expected: 2 },
        { rate: 24, expected: 2 },
        { rate: 25, expected: 3 },
      ])('scores rate=$rate as $expected', ({ rate, expected }) => {
        expect(scoreRespiratoryRate(rate)).toBe(expected);
      });
    });

    describe('scoreSpo2Scale1', () => {
      test.each([
        { spo2: 91, expected: 3 },
        { spo2: 92, expected: 2 },
        { spo2: 93, expected: 2 },
        { spo2: 94, expected: 1 },
        { spo2: 95, expected: 1 },
        { spo2: 96, expected: 0 },
      ])('scores SpO2=$spo2 as $expected', ({ spo2, expected }) => {
        expect(scoreSpo2Scale1(spo2)).toBe(expected);
      });
    });

    describe('scoreBloodPressureSystolic', () => {
      test.each([
        { systolic: 90, expected: 3 },
        { systolic: 91, expected: 2 },
        { systolic: 100, expected: 2 },
        { systolic: 101, expected: 1 },
        { systolic: 110, expected: 1 },
        { systolic: 111, expected: 0 },
        { systolic: 219, expected: 0 },
        { systolic: 220, expected: 3 },
      ])('scores systolic=$systolic as $expected', ({ systolic, expected }) => {
        expect(scoreBloodPressureSystolic(systolic)).toBe(expected);
      });
    });

    describe('scoreHeartRate', () => {
      test.each([
        { rate: 40, expected: 3 },
        { rate: 41, expected: 1 },
        { rate: 50, expected: 1 },
        { rate: 51, expected: 0 },
        { rate: 90, expected: 0 },
        { rate: 91, expected: 1 },
        { rate: 110, expected: 1 },
        { rate: 111, expected: 2 },
        { rate: 130, expected: 2 },
        { rate: 131, expected: 3 },
      ])('scores heartRate=$rate as $expected', ({ rate, expected }) => {
        expect(scoreHeartRate(rate)).toBe(expected);
      });
    });

    describe('scoreTemperature', () => {
      test.each([
        { temp: 35.0, expected: 3 },
        { temp: 35.1, expected: 1 },
        { temp: 36.0, expected: 1 },
        { temp: 36.1, expected: 0 },
        { temp: 38.0, expected: 0 },
        { temp: 38.1, expected: 1 },
        { temp: 39.0, expected: 1 },
        { temp: 39.1, expected: 2 },
      ])('scores temperature=$temp as $expected', ({ temp, expected }) => {
        expect(scoreTemperature(temp)).toBe(expected);
      });
    });
  });

  describe('calculateNews2 (Overall Risk Branches & Components)', () => {
    test.each([
      {
        branch: 'LOW (score 0)',
        input: {
          respiratoryRate: 16,
          spo2: 98,
          bloodPressureSystolic: 120,
          heartRate: 75,
          temperature: 37.0,
        },
        expected: {
          score: 0,
          risk: 'LOW' as const,
          components: {
            respiratoryRate: 0,
            spo2: 0,
            bloodPressureSystolic: 0,
            heartRate: 0,
            temperature: 0,
          },
        },
      },
      {
        branch: 'LOW_MEDIUM (score 1-4, score 2 without single 3)',
        input: {
          respiratoryRate: 21,
          spo2: 98,
          bloodPressureSystolic: 120,
          heartRate: 75,
          temperature: 37.0,
        },
        expected: {
          score: 2,
          risk: 'LOW_MEDIUM' as const,
          components: {
            respiratoryRate: 2,
            spo2: 0,
            bloodPressureSystolic: 0,
            heartRate: 0,
            temperature: 0,
          },
        },
      },
      {
        branch: 'MEDIUM via single component 3 with aggregate < 5',
        input: {
          respiratoryRate: 16,
          spo2: 91,
          bloodPressureSystolic: 120,
          heartRate: 75,
          temperature: 37.0,
        },
        expected: {
          score: 3,
          risk: 'MEDIUM' as const,
          components: {
            respiratoryRate: 0,
            spo2: 3,
            bloodPressureSystolic: 0,
            heartRate: 0,
            temperature: 0,
          },
        },
      },
      {
        branch: 'MEDIUM via aggregate 5/6 without any single 3',
        input: {
          respiratoryRate: 21,
          spo2: 93,
          bloodPressureSystolic: 120,
          heartRate: 91,
          temperature: 37.0,
        },
        expected: {
          score: 5,
          risk: 'MEDIUM' as const,
          components: {
            respiratoryRate: 2,
            spo2: 2,
            bloodPressureSystolic: 0,
            heartRate: 1,
            temperature: 0,
          },
        },
      },
      {
        branch: 'HIGH at aggregate exactly 7',
        input: {
          respiratoryRate: 21,
          spo2: 93,
          bloodPressureSystolic: 100,
          heartRate: 91,
          temperature: 37.0,
        },
        expected: {
          score: 7,
          risk: 'HIGH' as const,
          components: {
            respiratoryRate: 2,
            spo2: 2,
            bloodPressureSystolic: 2,
            heartRate: 1,
            temperature: 0,
          },
        },
      },
    ])('calculates $branch correctly', ({ input, expected }) => {
      expect(calculateNews2(input)).toEqual(expected);
    });
  });
});
