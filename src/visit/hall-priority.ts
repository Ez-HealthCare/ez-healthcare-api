export function ageOnDate(birth: Date | string | undefined, businessDate: string) {
  if (!birth) return undefined;
  const date = new Date(birth);
  if (!Number.isFinite(date.getTime())) return undefined;
  const iso = date.toISOString().slice(0, 10);
  if (iso > businessDate) return undefined;
  return (
    Number(businessDate.slice(0, 4)) -
    Number(iso.slice(0, 4)) -
    Number(businessDate.slice(5) < iso.slice(5))
  );
}
