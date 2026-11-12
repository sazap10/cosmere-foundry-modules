// Vorin date → Simple Calendar date parts. Pure; the sync itself lives in
// index.ts. The planner is the source of truth; Simple Calendar mirrors it.
import { parseVorin } from "./format";

export interface SimpleCalendarDate {
  year: number;
  /** 0-based month index. */
  month: number;
  /** 0-based day of the month. */
  day: number;
  hour?: number;
  minute?: number;
  seconds?: number;
}

/** Planner time-of-day words (free text) → hour. Unknown words leave the time alone. */
const TIME_OF_DAY_HOURS: Record<string, number> = {
  dawn: 6,
  morning: 9,
  midday: 12,
  noon: 12,
  afternoon: 15,
  dusk: 18,
  evening: 19,
  night: 22,
  midnight: 0,
};

export function timeOfDayHour(timeOfDay: string | null | undefined): number | null {
  if (!timeOfDay) return null;
  return TIME_OF_DAY_HOURS[timeOfDay.trim().toLowerCase()] ?? null;
}

/**
 * Y.M.W.D → { year, month: M-1, day: (W-1)*daysPerWeek + D - 1 }.
 * Null when the date doesn't parse or falls outside the target month.
 */
export function toSimpleCalendarDate(
  vorinDate: string,
  timeOfDay: string | null | undefined,
  calendar: { daysPerWeek: number; monthLengths: number[] },
): SimpleCalendarDate | null {
  const parts = parseVorin(vorinDate);
  if (!parts) return null;
  const [year, month, week, day] = parts;
  const monthIndex = month - 1;
  const dayIndex = (week - 1) * calendar.daysPerWeek + day - 1;
  const monthLength = calendar.monthLengths[monthIndex];
  if (monthLength === undefined || dayIndex < 0 || dayIndex >= monthLength) return null;
  const date: SimpleCalendarDate = { year, month: monthIndex, day: dayIndex };
  const hour = timeOfDayHour(timeOfDay);
  if (hour !== null) Object.assign(date, { hour, minute: 0, seconds: 0 });
  return date;
}
