import { describe, expect, it } from "vitest";
import {
  STRIKE_ABILITIES,
  addDisadvantage,
  focusLoss,
  ridersFor,
  turnEndExpires,
  weaponFits,
  type WeaponInfo,
} from "../../src/abilities/strike-abilities";

const weapon = (over: Partial<WeaponInfo> = {}): WeaponInfo => ({ kind: "weapon", melee: true, ranged: false, light: false, discreet: false, ...over });
const knife = weapon({ light: true, discreet: true });
const longsword = weapon();
const longbow = weapon({ melee: false, ranged: true });
const unarmed = weapon({ kind: "unarmed" });
const improvised = weapon({ kind: "improvised", light: true });

describe("weaponFits", () => {
  it("keeps each ability to the weapons its text allows", () => {
    const fits = (id: string) => [knife, longsword, longbow, unarmed, improvised].map((w) => weaponFits(STRIKE_ABILITIES[id], w));
    // knife, longsword, longbow, unarmed, improvised
    expect(fits("startling-blow")).toEqual([false, false, false, true, true]);
    expect(fits("fatal-thrust")).toEqual([true, false, false, false, true]);
    expect(fits("devastating-blow")).toEqual([true, true, false, true, true]);
    expect(fits("cheap-shot")).toEqual([false, false, false, true, false]);
    expect(fits("tagging-shot")).toEqual([false, false, true, false, false]);
  });
});

describe("ridersFor", () => {
  it("applies hit-only riders on a hit and hit-or-graze riders on a graze", () => {
    expect(ridersFor(STRIKE_ABILITIES["cheap-shot"], "hit").map((r) => r.kind)).toEqual(["condition"]);
    expect(ridersFor(STRIKE_ABILITIES["cheap-shot"], "graze")).toEqual([]);
    expect(ridersFor(STRIKE_ABILITIES["startling-blow"], "graze").map((r) => r.kind)).toEqual(["condition"]);
    // Feinting Strike: focus loss on both, the lost reaction only on a hit.
    expect(ridersFor(STRIKE_ABILITIES["feinting-strike"], "hit").map((r) => r.kind)).toEqual(["focus-loss", "note"]);
    expect(ridersFor(STRIKE_ABILITIES["feinting-strike"], "graze").map((r) => r.kind)).toEqual(["focus-loss"]);
  });

  it("applies nothing on a graze when the target can't be grazed", () => {
    expect(ridersFor(STRIKE_ABILITIES["startling-blow"], "graze", true)).toEqual([]);
    expect(ridersFor(STRIKE_ABILITIES["startling-blow"], "hit", true).map((r) => r.kind)).toEqual(["condition"]);
  });

  it("halves focus loss on a graze, rounding up", () => {
    expect([focusLoss(3, "hit"), focusLoss(3, "graze"), focusLoss(0, "graze")]).toEqual([3, 2, 0]);
  });
});

describe("turnEndExpires", () => {
  it("lasts through the current turn when applied on the combatant's own turn", () => {
    const applied = { round: 2, turn: 1 };
    expect(turnEndExpires(applied, { round: 2, turn: 1, combatantId: "x" }, "x")).toBe(false);
    expect(turnEndExpires(applied, { round: 3, turn: 1, combatantId: "x" }, "x")).toBe(true);
  });

  it("ends at the combatant's next turn when applied on someone else's", () => {
    expect(turnEndExpires({ round: 2, turn: 0 }, { round: 2, turn: 3, combatantId: "x" }, "x")).toBe(true);
    expect(turnEndExpires({ round: 2, turn: 3 }, { round: 2, turn: 4, combatantId: "y" }, "x")).toBe(false);
  });
});

describe("addDisadvantage", () => {
  it("cancels an advantage, otherwise gives disadvantage", () => {
    expect([addDisadvantage("advantage"), addDisadvantage("none"), addDisadvantage(undefined), addDisadvantage("disadvantage")]).toEqual([
      "none",
      "disadvantage",
      "disadvantage",
      "disadvantage",
    ]);
  });
});
