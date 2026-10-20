import {
  BUSINESS_TIME_ZONE,
  BUSINESS_WINDOWS,
  VN_OFFSET_MS,
} from '../common/constants/clinical.constants';
import { ShiftType } from '../department/enums/shift-type.enum';

function localParts(now: Date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function minutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function getBusinessTime(
  now = new Date(),
  windows: ReadonlyArray<{ start: string; end: string }> = BUSINESS_WINDOWS,
) {
  const parts = localParts(now);
  const isIssuanceOpen = windows.some(
    (window) => parts.minutes >= minutes(window.start) && parts.minutes < minutes(window.end),
  );
  const shiftType =
    parts.minutes >= minutes(windows[0].start) && parts.minutes < minutes(windows[0].end)
      ? ShiftType.MORNING
      : windows[1] &&
          parts.minutes >= minutes(windows[1].start) &&
          parts.minutes < minutes(windows[1].end)
        ? ShiftType.AFTERNOON
        : null;
  const closeMinutes = minutes(windows.at(-1)!.end);
  const closeHour = Math.floor(closeMinutes / 60);
  const closeMinute = closeMinutes % 60;
  const expiresAt = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, closeHour, closeMinute) - VN_OFFSET_MS,
  );
  return { businessDate: parts.date, isIssuanceOpen, shiftType, expiresAt };
}
