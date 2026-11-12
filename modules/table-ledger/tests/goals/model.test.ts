import { describe, expect, it } from "vitest";
import {
  buildPips,
  clampLevel,
  filterCompleted,
  isComplete,
  sortCharacters,
  sortGoals,
  stepLevel,
  toCharacterRow,
  toCharacterRows,
} from "../../src/goals/model";
import type { CharacterGoals } from "../../src/adapters/types";

const goal = (name: string, level: number, max = 3) => ({ itemUuid: `Item.${name}`, name, level, max });

describe("clampLevel", () => {
  it("clamps to [0, max] and truncates", () => {
    expect(clampLevel(-1, 3)).toBe(0);
    expect(clampLevel(5, 3)).toBe(3);
    expect(clampLevel(2.7, 3)).toBe(2);
    expect(clampLevel(Number.NaN, 3)).toBe(0);
  });
});

describe("stepLevel", () => {
  it("adds and removes one pip within bounds", () => {
    expect(stepLevel(goal("a", 1), 1)).toBe(2);
    expect(stepLevel(goal("a", 3), 1)).toBe(3);
    expect(stepLevel(goal("a", 0), -1)).toBe(0);
    expect(stepLevel(goal("a", 2), -1)).toBe(1);
  });
});

describe("buildPips", () => {
  it("builds max pips with level filled", () => {
    expect(buildPips(2, 3).map((p) => p.filled)).toEqual([true, true, false]);
    expect(buildPips(9, 3).every((p) => p.filled)).toBe(true);
    expect(buildPips(0, 0)).toEqual([]);
  });
});

describe("sorting and filtering", () => {
  const goals = [goal("done", 3), goal("b", 1), goal("a", 0)];

  it("puts completed goals last, keeping order otherwise", () => {
    expect(sortGoals(goals).map((g) => g.name)).toEqual(["b", "a", "done"]);
  });

  it("hides completed goals only when asked", () => {
    expect(filterCompleted(goals, true).map((g) => g.name)).toEqual(["b", "a"]);
    expect(filterCompleted(goals, false)).toHaveLength(3);
    expect(isComplete(goal("x", 3))).toBe(true);
  });

  it("sorts characters by name", () => {
    expect(sortCharacters([{ actorName: "Shallan" }, { actorName: "Kaladin" }]).map((c) => c.actorName)).toEqual([
      "Kaladin",
      "Shallan",
    ]);
  });
});

describe("toCharacterRow", () => {
  const character: CharacterGoals = {
    actorUuid: "Actor.k",
    actorName: "Kaladin",
    goals: [goal("Protect", 3), goal("Swear the Third Ideal", 2)],
  };

  it("counts completed goals and builds pips", () => {
    const row = toCharacterRow(character);
    expect(row.completedCount).toBe(1);
    expect(row.totalCount).toBe(2);
    expect(row.hiddenCount).toBe(0);
    expect(row.goals.map((g) => g.name)).toEqual(["Swear the Third Ideal", "Protect"]);
    expect(row.goals[1].complete).toBe(true);
    expect(row.goals[0].pips.filter((p) => p.filled)).toHaveLength(2);
  });

  it("reports hidden goals when completed are filtered", () => {
    const row = toCharacterRow(character, true);
    expect(row.goals).toHaveLength(1);
    expect(row.hiddenCount).toBe(1);
    expect(row.completedCount).toBe(1);
  });

  it("builds rows for all characters, sorted", () => {
    const rows = toCharacterRows([{ ...character, actorName: "Shallan" }, character]);
    expect(rows.map((r) => r.actorName)).toEqual(["Kaladin", "Shallan"]);
  });
});
