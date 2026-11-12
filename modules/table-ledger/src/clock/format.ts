// Pure formatting for the world-clock widget. Strings that need translating go
// through the injected `t` so this module never touches Foundry globals.
import type { CalendarSnapshot, LastStorm, NextStorm, StormIntensity } from "./snapshot";

export type Translate = (key: string, data?: Record<string, unknown>) => string;

/** Vorin months, 1-indexed (Roshar calendar: 10 months of 10 weeks of 5 days). */
export const VORIN_MONTHS = ["Jes", "Nan", "Chach", "Vev", "Palah", "Shash", "Betab", "Kak", "Tanat", "Ishi"] as const;

const VORIN_DATE = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

export function parseVorin(date: string): [number, number, number, number] | null {
  const m = VORIN_DATE.exec(date.trim());
  if (!m) return null;
  const [year, month, week, day] = m.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 10 || week < 1 || week > 10 || day < 1 || day > 5) return null;
  return [year, month, week, day];
}

/**
 * `YYYY.M.W.D` → `"<Month> W.D, YYYY"` (e.g. `1174.3.3.5` → `Chach 3.5, 1174`).
 * Anything that isn't a valid Vorin date is returned unchanged, so other
 * settings' calendars still display.
 */
export function formatVorinDate(date: string): string {
  const p = parseVorin(date);
  if (!p) return date;
  const [year, month, week, day] = p;
  return `${VORIN_MONTHS[month - 1]} ${week}.${day}, ${year}`;
}

/** Days from Vorin date `from` to `to` (500-day years, no leap days), or null if either doesn't parse. */
export function vorinDaysBetween(from: string, to: string): number | null {
  const a = parseVorin(from);
  const b = parseVorin(to);
  if (!a || !b) return null;
  const abs = ([y, m, w, d]: [number, number, number, number]) => (y - 1) * 500 + (m - 1) * 50 + (w - 1) * 5 + (d - 1);
  return abs(b) - abs(a);
}

/** Relative day text: today / tomorrow / in N days / N days overdue / unknown. */
export function relativeDays(inDays: number | null | undefined, t: Translate): string {
  if (inDays === null || inDays === undefined || !Number.isFinite(inDays)) return t("Clock.Relative.Unknown");
  if (inDays === 0) return t("Clock.Relative.Today");
  if (inDays === 1) return t("Clock.Relative.Tomorrow");
  if (inDays > 1) return t("Clock.Relative.InDays", { n: inDays });
  return t("Clock.Relative.Overdue", { n: -inDays });
}

/** A snapshot is stale when it was pushed more than `staleDays` real days ago. `staleDays <= 0` disables the check. */
export function isStale(pushedAt: string, now: Date, staleDays: number): boolean {
  if (!(staleDays > 0)) return false;
  const pushed = Date.parse(pushedAt);
  if (Number.isNaN(pushed)) return true;
  return now.getTime() - pushed > staleDays * 86_400_000;
}

/** Whole real days since the push (never negative). */
export function daysSince(pushedAt: string, now: Date): number {
  const pushed = Date.parse(pushedAt);
  if (Number.isNaN(pushed)) return 0;
  return Math.max(0, Math.floor((now.getTime() - pushed) / 86_400_000));
}

const INTENSITY_ICONS: Record<StormIntensity | "unknown", string> = {
  weak: "fa-solid fa-cloud-rain",
  normal: "fa-solid fa-cloud-bolt",
  mighty: "fa-solid fa-tornado",
  unknown: "fa-solid fa-cloud",
};

export function intensityIcon(intensity: StormIntensity | null): string {
  return INTENSITY_ICONS[intensity ?? "unknown"];
}

export const MAX_WIDGET_EVENTS = 3;

export interface ClockView {
  empty: boolean;
  date?: string;
  rawDate?: string;
  timeOfDay?: string | null;
  stormlight?: { available: boolean; label: string } | null;
  next: NextStormView;
  last: LastStormView | null;
  /** Null when the snapshot has no everstorm data (other settings, older planners). */
  everstorm: { next: NextStormView; last: LastStormView | null } | null;
  events: { date: string; label: string; type: string | null; relative: string }[];
  stale: { label: string; tooltip: string } | null;
}

type NextStormView = { date: string | null; relative: string; confidence: string | null };
type LastStormView = { date: string; intensity: string; icon: string; notes: string | null };

function nextStormView(storm: NextStorm | null, t: Translate): NextStormView {
  return storm
    ? { date: formatVorinDate(storm.vorin_date), relative: relativeDays(storm.in_days, t), confidence: storm.confidence }
    : { date: null, relative: t("Clock.Relative.Unknown"), confidence: null };
}

function lastStormView(storm: LastStorm | null, t: Translate): LastStormView | null {
  return storm
    ? {
        date: formatVorinDate(storm.vorin_date),
        intensity: t(`Clock.Intensity.${storm.intensity ?? "unknown"}`),
        icon: intensityIcon(storm.intensity),
        notes: storm.notes ?? null,
      }
    : null;
}

/** Build the widget's template context from the stored snapshot. */
export function buildClockView(
  snapshot: CalendarSnapshot | null,
  opts: { now: Date; staleDays: number; t: Translate },
): ClockView {
  const { now, staleDays, t } = opts;
  if (!snapshot) {
    return { empty: true, next: nextStormView(null, t), last: null, everstorm: null, events: [], stale: null };
  }

  const { next_everstorm: ne, last_everstorm: le } = snapshot;
  const events = [...snapshot.upcoming_events]
    .filter((e) => e.in_days >= 0)
    .sort((a, b) => a.in_days - b.in_days)
    .slice(0, MAX_WIDGET_EVENTS)
    .map((e) => ({ date: formatVorinDate(e.vorin_date), label: e.label, type: e.type, relative: relativeDays(e.in_days, t) }));

  return {
    empty: false,
    date: formatVorinDate(snapshot.current.vorin_date),
    rawDate: snapshot.current.vorin_date,
    timeOfDay: snapshot.current.time_of_day,
    stormlight:
      snapshot.stormlight_available === null
        ? null
        : {
            available: snapshot.stormlight_available,
            label: t(snapshot.stormlight_available ? "Clock.Stormlight.Available" : "Clock.Stormlight.Unavailable"),
          },
    next: nextStormView(snapshot.next_highstorm, t),
    last: lastStormView(snapshot.last_highstorm, t),
    everstorm: ne || le ? { next: nextStormView(ne, t), last: lastStormView(le, t) } : null,
    events,
    stale: isStale(snapshot.pushed_at, now, staleDays)
      ? { label: t("Clock.Stale.Label"), tooltip: t("Clock.Stale.Tooltip", { n: daysSince(snapshot.pushed_at, now) }) }
      : null,
  };
}
