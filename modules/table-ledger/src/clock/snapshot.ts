// Calendar snapshot pushed by the planner (`table-ledger.setCalendar`) or
// entered by hand in the GM edit form. Pure: no Foundry globals.

export type StormIntensity = "weak" | "normal" | "mighty";

export interface NextStorm {
  vorin_date: string;
  in_days: number;
  confidence: string | null;
}

export interface LastStorm {
  vorin_date: string;
  intensity: StormIntensity | null;
  notes?: string;
}

export interface CalendarSnapshot {
  current: { vorin_date: string; time_of_day: string | null };
  stormlight_available: boolean | null;
  next_highstorm: NextStorm | null;
  last_highstorm: LastStorm | null;
  /** Absent in snapshots from planners older than everstorm support; normalised to null. */
  next_everstorm: NextStorm | null;
  last_everstorm: LastStorm | null;
  upcoming_events: { vorin_date: string; label: string; type: string | null; in_days: number }[];
  /** ISO timestamp of when the snapshot was produced. */
  pushed_at: string;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const INTENSITIES: readonly StormIntensity[] = ["weak", "normal", "mighty"];
const MAX_TEXT = 200;
const MAX_NOTES = 2000;
const MAX_EVENTS = 50;

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Invalid(`${path} must be an object`);
  return v as Obj;
}

function str(v: unknown, path: string, max = MAX_TEXT): string {
  if (typeof v !== "string") throw new Invalid(`${path} must be a string`);
  const s = v.trim();
  if (!s) throw new Invalid(`${path} must not be empty`);
  if (s.length > max) throw new Invalid(`${path} is longer than ${max} characters`);
  return s;
}

function optStr(v: unknown, path: string, max = MAX_TEXT): string | null {
  if (v === null || v === undefined || v === "") return null;
  return str(v, path, max);
}

function int(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Invalid(`${path} must be an integer`);
  return v;
}

function parseNextStorm(value: unknown, path: string): NextStorm | null {
  if (value === null || value === undefined) return null;
  const n = obj(value, path);
  return {
    vorin_date: str(n.vorin_date, `${path}.vorin_date`),
    in_days: int(n.in_days, `${path}.in_days`),
    confidence: optStr(n.confidence, `${path}.confidence`),
  };
}

function isIntensity(value: unknown): value is StormIntensity {
  return typeof value === "string" && (INTENSITIES as readonly string[]).includes(value);
}

function parseLastStorm(value: unknown, path: string): LastStorm | null {
  if (value === null || value === undefined) return null;
  const l = obj(value, path);
  const intensity = l.intensity ?? null;
  if (intensity !== null && !isIntensity(intensity)) {
    throw new Invalid(`${path}.intensity must be one of ${INTENSITIES.join(", ")} or null`);
  }
  const last: LastStorm = { vorin_date: str(l.vorin_date, `${path}.vorin_date`), intensity };
  const notes = optStr(l.notes, `${path}.notes`, MAX_NOTES);
  if (notes) last.notes = notes;
  return last;
}

function parseSnapshot(data: unknown): CalendarSnapshot {
  const root = obj(data, "snapshot");

  const cur = obj(root.current, "current");
  const current = { vorin_date: str(cur.vorin_date, "current.vorin_date"), time_of_day: optStr(cur.time_of_day, "current.time_of_day") };

  const sa = root.stormlight_available;
  if (sa !== null && sa !== undefined && typeof sa !== "boolean") throw new Invalid("stormlight_available must be a boolean or null");
  const stormlight_available = typeof sa === "boolean" ? sa : null;

  const next_highstorm = parseNextStorm(root.next_highstorm, "next_highstorm");
  const last_highstorm = parseLastStorm(root.last_highstorm, "last_highstorm");
  const next_everstorm = parseNextStorm(root.next_everstorm, "next_everstorm");
  const last_everstorm = parseLastStorm(root.last_everstorm, "last_everstorm");

  const events = root.upcoming_events ?? [];
  if (!Array.isArray(events)) throw new Invalid("upcoming_events must be an array");
  if (events.length > MAX_EVENTS) throw new Invalid(`upcoming_events has more than ${MAX_EVENTS} entries`);
  const upcoming_events = events.map((e, i) => {
    const ev = obj(e, `upcoming_events[${i}]`);
    return {
      vorin_date: str(ev.vorin_date, `upcoming_events[${i}].vorin_date`),
      label: str(ev.label, `upcoming_events[${i}].label`),
      type: optStr(ev.type, `upcoming_events[${i}].type`),
      in_days: int(ev.in_days, `upcoming_events[${i}].in_days`),
    };
  });

  const pushed_at = str(root.pushed_at, "pushed_at");
  if (Number.isNaN(Date.parse(pushed_at))) throw new Invalid("pushed_at must be an ISO timestamp");

  return {
    current,
    stormlight_available,
    next_highstorm,
    last_highstorm,
    next_everstorm,
    last_everstorm,
    upcoming_events,
    pushed_at,
  };
}

/** Validate an untrusted payload and return a normalised copy (unknown keys dropped, strings trimmed). */
export function validateCalendar(data: unknown): Validation<CalendarSnapshot> {
  try {
    return { ok: true, value: parseSnapshot(data) };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}
