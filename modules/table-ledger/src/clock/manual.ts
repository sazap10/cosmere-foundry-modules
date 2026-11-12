// Turn the GM's manual edit form into a calendar snapshot. Pure.
import { vorinDaysBetween } from "./format";
import { validateCalendar, type CalendarSnapshot, type LastStorm, type NextStorm, type Validation } from "./snapshot";

/** One storm type's fields in the form (highstorm and everstorm share the shape). */
export interface ManualStormInput {
  next_date: string;
  /** Blank → computed from the two Vorin dates when both parse. */
  next_in_days: number | null;
  next_confidence: string;
  last_date: string;
  last_intensity: string;
  last_notes: string;
}

export interface ManualCalendarInput {
  vorin_date: string;
  time_of_day: string;
  /** "" = unknown. */
  stormlight: "" | "true" | "false";
  highstorm: ManualStormInput;
  everstorm: ManualStormInput;
}

function stormInputFrom(next: NextStorm | null | undefined, last: LastStorm | null | undefined): ManualStormInput {
  return {
    next_date: next?.vorin_date ?? "",
    next_in_days: next?.in_days ?? null,
    next_confidence: next?.confidence ?? "",
    last_date: last?.vorin_date ?? "",
    last_intensity: last?.intensity ?? "",
    last_notes: last?.notes ?? "",
  };
}

/** Form defaults from the stored snapshot. */
export function manualInputFrom(prev: CalendarSnapshot | null): ManualCalendarInput {
  return {
    vorin_date: prev?.current.vorin_date ?? "",
    time_of_day: prev?.current.time_of_day ?? "",
    stormlight: prev?.stormlight_available === null || !prev ? "" : prev.stormlight_available ? "true" : "false",
    highstorm: stormInputFrom(prev?.next_highstorm, prev?.last_highstorm),
    everstorm: stormInputFrom(prev?.next_everstorm, prev?.last_everstorm),
  };
}

function stormFrom(
  date: string,
  input: ManualStormInput,
  label: string,
): { ok: true; next: NextStorm | null; last: LastStorm | null } | { ok: false; error: string } {
  const nextDate = input.next_date.trim();
  const lastDate = input.last_date.trim();
  let next: NextStorm | null = null;
  if (nextDate) {
    const inDays = input.next_in_days ?? vorinDaysBetween(date, nextDate);
    if (inDays === null) return { ok: false, error: `next ${label} needs 'in days' when the dates aren't YYYY.M.W.D` };
    next = { vorin_date: nextDate, in_days: inDays, confidence: input.next_confidence.trim() || null };
  }
  const intensity = input.last_intensity;
  const last: LastStorm | null = lastDate
    ? {
        vorin_date: lastDate,
        intensity: intensity === "weak" || intensity === "normal" || intensity === "mighty" ? intensity : null,
        notes: input.last_notes.trim() || undefined,
      }
    : null;
  return { ok: true, next, last };
}

/**
 * Build a new snapshot from the form. Upcoming events are carried over from
 * the previous snapshot with `in_days` recomputed against the new date where
 * the dates parse; events now in the past are dropped.
 */
export function applyManualEdit(
  prev: CalendarSnapshot | null,
  input: ManualCalendarInput,
  pushedAt: string,
): Validation<CalendarSnapshot> {
  const date = input.vorin_date.trim();
  const high = stormFrom(date, input.highstorm, "highstorm");
  if (!high.ok) return high;
  const ever = stormFrom(date, input.everstorm, "everstorm");
  if (!ever.ok) return ever;

  const events = (prev?.upcoming_events ?? [])
    .map((e) => ({ ...e, in_days: vorinDaysBetween(date, e.vorin_date) ?? e.in_days }))
    .filter((e) => e.in_days >= 0);

  return validateCalendar({
    current: { vorin_date: date, time_of_day: input.time_of_day.trim() || null },
    stormlight_available: input.stormlight === "" ? null : input.stormlight === "true",
    next_highstorm: high.next,
    last_highstorm: high.last,
    next_everstorm: ever.next,
    last_everstorm: ever.last,
    upcoming_events: events,
    pushed_at: pushedAt,
  });
}
