import { getBusinessTime } from './business-time';

describe('business time', () => {
  it('keeps tickets active for the full local business day', () => {
    expect(getBusinessTime(new Date('2026-10-18T00:00:00Z')).isIssuanceOpen).toBe(true);
    expect(getBusinessTime(new Date('2026-10-18T05:00:00Z')).isIssuanceOpen).toBe(true);
    expect(getBusinessTime(new Date('2026-10-18T16:59:00Z')).isIssuanceOpen).toBe(true);
  });

  it('uses exact Ho Chi Minh boundaries and changes business date at local midnight', () => {
    expect(getBusinessTime(new Date('2026-10-18T04:30:00Z')).isIssuanceOpen).toBe(true);
    expect(getBusinessTime(new Date('2026-10-18T06:00:00Z')).isIssuanceOpen).toBe(true);
    expect(getBusinessTime(new Date('2026-10-18T09:30:00Z')).isIssuanceOpen).toBe(true);
    expect(getBusinessTime(new Date('2026-10-18T16:59:00Z')).businessDate).toBe('2026-10-18');
    expect(getBusinessTime(new Date('2026-10-18T17:00:00Z')).businessDate).toBe('2026-10-19');
  });
});
