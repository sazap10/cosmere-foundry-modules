import { describe, expect, it } from "vitest";
import { toSimpleCalendarDate } from "../../src/clock/simple-calendar";

const ROSHAR = { daysPerWeek: 5, monthLengths: Array(10).fill(50) };

describe("toSimpleCalendarDate", () => {
  it("maps Y.M.W.D to 0-based month/day", () => {
    // Chach 3.5 = 15th day of Chach → Simple Calendar shows "Chach 15".
    expect(toSimpleCalendarDate("1174.3.3.5", null, ROSHAR)).toEqual({ year: 1174, month: 2, day: 14 });
    expect(toSimpleCalendarDate("1174.1.1.1", null, ROSHAR)).toEqual({ year: 1174, month: 0, day: 0 });
    expect(toSimpleCalendarDate("1174.10.10.5", null, ROSHAR)).toEqual({ year: 1174, month: 9, day: 49 });
  });

  it("sets the hour for known times of day and leaves the time alone otherwise", () => {
    expect(toSimpleCalendarDate("1174.3.3.5", "Afternoon", ROSHAR)).toEqual({ year: 1174, month: 2, day: 14, hour: 15, minute: 0, seconds: 0 });
    expect(toSimpleCalendarDate("1174.3.3.5", "just after the storm", ROSHAR)).toEqual({ year: 1174, month: 2, day: 14 });
  });

  it("refuses dates that don't fit the target calendar", () => {
    expect(toSimpleCalendarDate("not a date", null, ROSHAR)).toBeNull();
    expect(toSimpleCalendarDate("1174.3.3.5", null, { daysPerWeek: 5, monthLengths: [50, 50] })).toBeNull();
    expect(toSimpleCalendarDate("1174.1.10.5", null, { daysPerWeek: 5, monthLengths: [30] })).toBeNull();
  });
});
