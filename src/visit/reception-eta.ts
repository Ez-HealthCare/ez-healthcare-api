export function estimateReceptionStart(
  now: Date,
  closesAt: Date,
  counterCount: number,
  serviceMinutes: number,
  waitingAhead: number,
  calledAt: (Date | undefined)[],
): Date | null {
  const current = now.getTime();
  const duration = serviceMinutes * 60_000;
  if (calledAt.length > counterCount) return null;

  const availability = calledAt.map((called) => (called?.getTime() ?? NaN) + duration);
  // Without a release or revised estimate, an overdue call has unknown remaining time.
  if (availability.some((end) => !Number.isFinite(end) || end <= current)) return null;

  while (availability.length < counterCount) availability.push(current);
  for (let index = 0; index <= waitingAhead; index++) {
    const counter = availability.reduce(
      (earliest, time, candidate) => (time < availability[earliest] ? candidate : earliest),
      0,
    );
    const start = availability[counter];
    if (start + duration > closesAt.getTime()) return null;
    if (index === waitingAhead) return new Date(start);
    availability[counter] = start + duration;
  }
  return null;
}
