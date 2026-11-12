import { estimateReceptionStart } from './reception-eta';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 12, 1, minute));

describe('estimateReceptionStart', () => {
  it('schedules four simultaneous arrivals across two busy counters', () => {
    expect(
      [0, 1, 2, 3].map((ahead) =>
        estimateReceptionStart(at(4), at(30), 2, 5, ahead, [at(0), at(2)]),
      ),
    ).toEqual([at(5), at(7), at(10), at(12)]);
  });

  it('does not assume an overdue call has released a counter', () => {
    expect(estimateReceptionStart(at(5), at(30), 2, 5, 0, [at(0), at(2)])).toBeNull();
  });

  it('can start immediately when a counter is free', () => {
    expect(estimateReceptionStart(at(4), at(30), 2, 5, 0, [at(2)])).toEqual(at(4));
  });

  it('requires enough time to finish within the current window', () => {
    expect(estimateReceptionStart(at(28), at(30), 2, 5, 0, [])).toBeNull();
  });
});
