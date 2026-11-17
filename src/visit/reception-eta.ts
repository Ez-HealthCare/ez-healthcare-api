export function estimateReceptionStart(
  now: Date,
  closesAt: Date,
  counterCount: number,
  serviceMinutes: number,
  waitingAhead: number,
  calledAt: (Date | undefined)[],
): Date | null {
  return (
    estimateReceptionStarts(
      now,
      closesAt,
      counterCount,
      serviceMinutes,
      waitingAhead + 1,
      calledAt,
    )[waitingAhead] ?? null
  );
}

export function estimateReceptionStarts(
  now: Date,
  closesAt: Date,
  counterCount: number,
  serviceMinutes: number,
  count: number,
  calledAt: (Date | undefined)[],
): (Date | null)[] {
  const estimates = Array<Date | null>(count).fill(null);
  const current = now.getTime();
  const duration = serviceMinutes * 60_000;
  if (counterCount <= 0 || calledAt.length > counterCount) return estimates;

  const availability = calledAt.map((called) => (called?.getTime() ?? NaN) + duration);
  // Without a release or revised estimate, an overdue call has unknown remaining time.
  if (availability.some((end) => !Number.isFinite(end) || end <= current)) return estimates;

  while (availability.length < counterCount) availability.push(current);
  for (let index = 0; index < count; index++) {
    const counter = availability.reduce(
      (earliest, time, candidate) => (time < availability[earliest] ? candidate : earliest),
      0,
    );
    const start = availability[counter];
    if (start + duration > closesAt.getTime()) return estimates;
    estimates[index] = new Date(start);
    availability[counter] = start + duration;
  }
  return estimates;
}
