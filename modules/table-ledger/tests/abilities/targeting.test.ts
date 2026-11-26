import { describe, expect, it } from "vitest";
import { normaliseAction, type RawAction } from "../../src/abilities/audit-rules";
import { orderCandidates, pickedTargetLingers, shouldPickTarget, targetSide, type TargetCandidate } from "../../src/abilities/targeting";

const ALLY_IDS = ["field-medicine", "prg"];
const action = (raw: Partial<RawAction>, id?: string) => ({
  ...normaliseAction({ name: "Action", descriptionHtml: "", activationType: "utility", damageFormula: null, damageType: null, ...raw }),
  id,
});

describe("targetSide", () => {
  it("is enemy for skill tests that attack or test a defence", () => {
    expect(targetSide(action({ activationType: "skill_test", damageFormula: "1d6", damageType: "impact" }), ALLY_IDS)).toBe("enemy");
    expect(
      targetSide(action({ activationType: "skill_test", descriptionHtml: "<p>Test against the target's Spiritual defense.</p>" }), ALLY_IDS),
    ).toBe("enemy");
  });

  it("is ally for heals (even mis-set as skill test + heal) and listed ally abilities", () => {
    // Field Medicine before the audit fix: skill test + heal formula.
    expect(targetSide(action({ activationType: "skill_test", damageFormula: "@skills.med.rank", damageType: "heal" }), ALLY_IDS)).toBe("ally");
    // Field Medicine after the audit fix: plain skill test, matched by id.
    expect(targetSide(action({ activationType: "skill_test" }, "field-medicine"), ALLY_IDS)).toBe("ally");
    // Progression has no heal formula at all.
    expect(targetSide(action({ activationType: "utility" }, "prg"), ALLY_IDS)).toBe("ally");
  });

  it("is null for untargeted actions", () => {
    expect(targetSide(action({ activationType: "utility", descriptionHtml: "<p>Recover 1 focus.</p>" }), ALLY_IDS)).toBeNull();
    expect(targetSide(action({ activationType: "skill_test", descriptionHtml: "<p>Make an Insight test.</p>" }), ALLY_IDS)).toBeNull();
  });
});

describe("shouldPickTarget", () => {
  it("asks only when enabled, not re-entering, targeted ability and nothing targeted", () => {
    expect(shouldPickTarget({ enabled: true, reentering: false, side: "ally", targetCount: 0 })).toBe(true);
    expect(shouldPickTarget({ enabled: false, reentering: false, side: "ally", targetCount: 0 })).toBe(false);
    expect(shouldPickTarget({ enabled: true, reentering: true, side: "enemy", targetCount: 0 })).toBe(false);
    expect(shouldPickTarget({ enabled: true, reentering: false, side: "enemy", targetCount: 1 })).toBe(false);
    expect(shouldPickTarget({ enabled: true, reentering: false, side: null, targetCount: 0 })).toBe(false);
  });
});

describe("pickedTargetLingers", () => {
  it("is true only when the picker's token is still the sole target", () => {
    expect(pickedTargetLingers("t1", ["t1"])).toBe(true);
    expect(pickedTargetLingers(null, ["t1"])).toBe(false);
    expect(pickedTargetLingers("t1", ["t2"])).toBe(false);
    expect(pickedTargetLingers("t1", ["t1", "t2"])).toBe(false);
    expect(pickedTargetLingers("t1", [])).toBe(false);
  });
});

describe("orderCandidates", () => {
  const c = (name: string, disposition: number, isSelf = false): TargetCandidate => ({ actorUuid: name, name, disposition, isSelf });
  const list = [c("Bandit", -1), c("Alder", 1), c("Merchant", 0), c("Kestrel", 1, true), c("Ardent", 1)];

  it("puts other allies first, then yourself, for ally abilities", () => {
    expect(orderCandidates(list, "ally").map((x) => x.name)).toEqual(["Alder", "Ardent", "Kestrel", "Merchant", "Bandit"]);
  });

  it("puts hostiles first for attacks", () => {
    expect(orderCandidates(list, "enemy").map((x) => x.name)).toEqual(["Bandit", "Merchant", "Alder", "Ardent", "Kestrel"]);
  });
});
