import { buildClockView, formatVorinDate, intensityIcon, isStale, relativeDays, vorinDaysBetween } from "../../src/clock/format";
import { applyManualEdit, manualInputFrom } from "../../src/clock/manual";
import { validateCalendar, type CalendarSnapshot } from "../../src/clock/snapshot";

const t = (key: string, data?: Record<string, unknown>) => (data ? `${key}:${JSON.stringify(data)}` : key);

const snapshot = (over: Partial<CalendarSnapshot> = {}): CalendarSnapshot => ({
  current: { vorin_date: "1174.3.3.5", time_of_day: "Afternoon" },
  stormlight_available: true,
  next_highstorm: { vorin_date: "1174.4.1.2", in_days: 32, confidence: "low" },
  last_highstorm: { vorin_date: "1174.3.3.2", intensity: "normal", notes: "Late crossing" },
  next_everstorm: { vorin_date: "1174.3.5.3", in_days: 8, confidence: "medium" },
  last_everstorm: { vorin_date: "1173.10.10.3", intensity: "mighty" },
  upcoming_events: [],
  pushed_at: "2026-11-10T12:00:00.000Z",
  ...over,
});

const now = new Date("2026-11-11T12:00:00.000Z");

describe("formatVorinDate", () => {
  it("formats YYYY.M.W.D with the month name", () => {
    expect(formatVorinDate("1174.3.3.5")).toBe("Chach 3.5, 1174");
    expect(formatVorinDate("1173.10.10.5")).toBe("Ishi 10.5, 1173");
    expect(formatVorinDate("1174.1.1.1")).toBe("Jes 1.1, 1174");
  });

  it("returns anything else unchanged", () => {
    expect(formatVorinDate("Day of Storms")).toBe("Day of Storms");
    expect(formatVorinDate("1174.11.1.1")).toBe("1174.11.1.1");
    expect(formatVorinDate("1174.3.3.6")).toBe("1174.3.3.6");
  });
});

describe("vorinDaysBetween", () => {
  it("counts days across weeks, months and years", () => {
    expect(vorinDaysBetween("1174.3.3.5", "1174.4.1.2")).toBe(37);
    expect(vorinDaysBetween("1174.3.3.5", "1174.3.3.5")).toBe(0);
    expect(vorinDaysBetween("1173.10.10.5", "1174.1.1.1")).toBe(1);
    expect(vorinDaysBetween("1174.3.3.5", "1174.3.3.2")).toBe(-3);
  });

  it("is null when a date doesn't parse", () => {
    expect(vorinDaysBetween("1174.3.3.5", "soon")).toBeNull();
  });
});

describe("relativeDays", () => {
  it("gives today, tomorrow and in N days", () => {
    expect(relativeDays(0, t)).toBe("Clock.Relative.Today");
    expect(relativeDays(1, t)).toBe("Clock.Relative.Tomorrow");
    expect(relativeDays(4, t)).toBe('Clock.Relative.InDays:{"n":4}');
  });

  it("gives unknown with no prediction", () => {
    expect(relativeDays(null, t)).toBe("Clock.Relative.Unknown");
    expect(relativeDays(undefined, t)).toBe("Clock.Relative.Unknown");
  });

  it("reports a passed prediction as overdue", () => {
    expect(relativeDays(-2, t)).toBe('Clock.Relative.Overdue:{"n":2}');
  });
});

describe("isStale", () => {
  it("is stale only past the threshold", () => {
    expect(isStale("2026-10-27T11:59:00.000Z", now, 14)).toBe(true);
    expect(isStale("2026-10-28T12:00:00.000Z", now, 14)).toBe(false);
    expect(isStale("2026-11-10T12:00:00.000Z", now, 14)).toBe(false);
  });

  it("is disabled at 0 days and stale on an unreadable timestamp", () => {
    expect(isStale("2020-01-01T00:00:00.000Z", now, 0)).toBe(false);
    expect(isStale("not a date", now, 14)).toBe(true);
  });
});

describe("buildClockView", () => {
  it("renders the empty state without a snapshot", () => {
    const view = buildClockView(null, { now, staleDays: 14, t });
    expect(view.empty).toBe(true);
    expect(view.next.relative).toBe("Clock.Relative.Unknown");
  });

  it("formats a full snapshot", () => {
    const view = buildClockView(snapshot(), { now, staleDays: 14, t });
    expect(view.date).toBe("Chach 3.5, 1174");
    expect(view.timeOfDay).toBe("Afternoon");
    expect(view.stormlight).toEqual({ available: true, label: "Clock.Stormlight.Available" });
    expect(view.next).toEqual({ date: "Vev 1.2, 1174", relative: 'Clock.Relative.InDays:{"n":32}', confidence: "low" });
    expect(view.last).toEqual({ date: "Chach 3.2, 1174", intensity: "Clock.Intensity.normal", icon: intensityIcon("normal"), notes: "Late crossing" });
    expect(view.stale).toBeNull();
  });

  it("shows unknown next highstorm and hides an unknown stormlight state", () => {
    const view = buildClockView(snapshot({ next_highstorm: null, stormlight_available: null, last_highstorm: null }), { now, staleDays: 14, t });
    expect(view.next).toEqual({ date: null, relative: "Clock.Relative.Unknown", confidence: null });
    expect(view.stormlight).toBeNull();
    expect(view.last).toBeNull();
  });

  it("shows the everstorm section only when the snapshot has everstorm data", () => {
    const view = buildClockView(snapshot(), { now, staleDays: 14, t });
    expect(view.everstorm).toEqual({
      next: { date: "Chach 5.3, 1174", relative: 'Clock.Relative.InDays:{"n":8}', confidence: "medium" },
      last: { date: "Ishi 10.3, 1173", intensity: "Clock.Intensity.mighty", icon: intensityIcon("mighty"), notes: null },
    });
    // Next unknown but a last strike recorded: still shown.
    expect(buildClockView(snapshot({ next_everstorm: null }), { now, staleDays: 14, t }).everstorm?.next.relative).toBe(
      "Clock.Relative.Unknown",
    );
    // Scadrial, or a planner without everstorm support.
    expect(buildClockView(snapshot({ next_everstorm: null, last_everstorm: null }), { now, staleDays: 14, t }).everstorm).toBeNull();
  });

  it("shows a stale badge for an old snapshot", () => {
    const view = buildClockView(snapshot({ pushed_at: "2026-10-01T12:00:00.000Z" }), { now, staleDays: 14, t });
    expect(view.stale).toEqual({ label: "Clock.Stale.Label", tooltip: 'Clock.Stale.Tooltip:{"n":41}' });
  });

  it("shows at most 3 upcoming events, soonest first, skipping past ones", () => {
    const ev = (label: string, in_days: number) => ({ vorin_date: "1174.3.4.1", label, type: null, in_days });
    const view = buildClockView(snapshot({ upcoming_events: [ev("d", 9), ev("past", -1), ev("a", 0), ev("c", 5), ev("b", 1)] }), {
      now,
      staleDays: 14,
      t,
    });
    expect(view.events.map((e) => [e.label, e.relative])).toEqual([
      ["a", "Clock.Relative.Today"],
      ["b", "Clock.Relative.Tomorrow"],
      ["c", 'Clock.Relative.InDays:{"n":5}'],
    ]);
  });
});

describe("validateCalendar", () => {
  it("accepts and normalises a valid snapshot", () => {
    const result = validateCalendar({ ...snapshot(), extra: 1, current: { vorin_date: " 1174.3.3.5 ", time_of_day: "" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.current).toEqual({ vorin_date: "1174.3.3.5", time_of_day: null });
    expect("extra" in result.value).toBe(false);
  });

  it("accepts missing optional sections as null", () => {
    const result = validateCalendar({ current: { vorin_date: "1174.3.3.5" }, pushed_at: "2026-11-10T12:00:00Z" });
    expect(result).toEqual({
      ok: true,
      value: {
        current: { vorin_date: "1174.3.3.5", time_of_day: null },
        stormlight_available: null,
        next_highstorm: null,
        last_highstorm: null,
        next_everstorm: null,
        last_everstorm: null,
        upcoming_events: [],
        pushed_at: "2026-11-10T12:00:00Z",
      },
    });
  });

  it.each([
    ["not an object", "x"],
    ["missing current", { pushed_at: "2026-11-10T12:00:00Z" }],
    ["empty date", { ...snapshot(), current: { vorin_date: "", time_of_day: null } }],
    ["fractional in_days", { ...snapshot(), next_highstorm: { vorin_date: "1174.4.1.2", in_days: 1.5, confidence: null } }],
    ["bad intensity", { ...snapshot(), last_highstorm: { vorin_date: "1174.3.3.2", intensity: "huge" } }],
    ["bad stormlight", { ...snapshot(), stormlight_available: "yes" }],
    ["events not an array", { ...snapshot(), upcoming_events: {} }],
    ["event missing label", { ...snapshot(), upcoming_events: [{ vorin_date: "1174.3.4.1", in_days: 2 }] }],
    ["bad pushed_at", { ...snapshot(), pushed_at: "yesterday" }],
    ["bad everstorm intensity", { ...snapshot(), last_everstorm: { vorin_date: "1173.10.10.3", intensity: "huge" } }],
  ])("rejects %s", (_name, payload) => {
    expect(validateCalendar(payload).ok).toBe(false);
  });
});

describe("applyManualEdit", () => {
  it("round-trips the stored snapshot through the form", () => {
    const prev = snapshot();
    const result = applyManualEdit(prev, manualInputFrom(prev), prev.pushed_at);
    expect(result).toEqual({ ok: true, value: prev });
  });

  it("computes in_days from the dates when left blank and re-bases events", () => {
    const prev = snapshot({
      upcoming_events: [
        { vorin_date: "1174.3.4.2", label: "Market", type: null, in_days: 2 },
        { vorin_date: "1174.3.4.1", label: "Gone", type: null, in_days: 1 },
      ],
    });
    const input = { ...manualInputFrom(prev), vorin_date: "1174.3.4.1" };
    input.highstorm.next_in_days = null;
    input.everstorm.next_in_days = null;
    const result = applyManualEdit(prev, input, "2026-11-11T12:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next_highstorm?.in_days).toBe(36);
    // 1174.3.4.1 → 1174.3.5.3 is 7 days.
    expect(result.value.next_everstorm?.in_days).toBe(7);
    expect(result.value.upcoming_events).toEqual([
      { vorin_date: "1174.3.4.2", label: "Market", type: null, in_days: 1 },
      { vorin_date: "1174.3.4.1", label: "Gone", type: null, in_days: 0 },
    ]);
    expect(result.value.pushed_at).toBe("2026-11-11T12:00:00.000Z");
  });

  it("clears sections left blank and rejects an uncomputable in_days", () => {
    const base = { ...manualInputFrom(null), vorin_date: "1174.3.3.5" };
    const cleared = applyManualEdit(null, base, "2026-11-11T12:00:00.000Z");
    expect(cleared.ok && cleared.value.next_highstorm === null && cleared.value.last_everstorm === null).toBe(true);
    const badHigh = { ...base, highstorm: { ...base.highstorm, next_date: "after the storm" } };
    expect(applyManualEdit(null, badHigh, "2026-11-11T12:00:00.000Z")).toEqual({
      ok: false,
      error: "next highstorm needs 'in days' when the dates aren't YYYY.M.W.D",
    });
    const badEver = { ...base, everstorm: { ...base.everstorm, next_date: "soon" } };
    expect(applyManualEdit(null, badEver, "2026-11-11T12:00:00.000Z").ok).toBe(false);
  });
});
