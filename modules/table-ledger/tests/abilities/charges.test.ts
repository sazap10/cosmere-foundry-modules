import { describe, expect, it } from "vitest";
import { auditAction, normaliseAction } from "../../src/abilities/audit-rules";
import { consumableCounter, consumptionEntry, firstCounter } from "../../src/abilities/charges";

const item = (charges?: { key: string; consumed: boolean; actionCount: number }) => ({
  ...normaliseAction({ name: "Alerter", descriptionHtml: "", activationType: null, damageFormula: null, damageType: null }),
  charges,
});

describe("firstCounter", () => {
  it("prefers charges, then uses, then ammo, and skips unset counters", () => {
    expect(firstCounter({ uses: { value: 1, max: 2 }, ammo: { value: 5, max: 5 }, charges: null })).toEqual({ key: "uses", value: 1, max: 2 });
    expect(firstCounter({ charges: { value: 0, max: 3 }, uses: { value: 1, max: 2 } })).toEqual({ key: "charges", value: 0, max: 3 });
    expect(firstCounter({ charges: null, uses: null, ammo: null })).toBeNull();
    expect(firstCounter(undefined)).toBeNull();
  });
});

describe("consumableCounter", () => {
  it("ignores uses, which the action spends itself", () => {
    expect(consumableCounter({ uses: { value: 1, max: 2 } })).toBeNull();
    expect(consumableCounter({ uses: { value: 1, max: 2 }, ammo: { value: 3, max: 6 } })).toEqual({ key: "ammo", value: 3, max: 6 });
  });
});

describe("consumptionEntry", () => {
  it("spends one of the parent item's counters", () => {
    expect(consumptionEntry("charges")).toMatchObject({
      type: "item_resource",
      resource: "charges",
      value: { min: 1, max: 1, actual: 1 },
      matchDocument: { steps: [{ target: "parent" }] },
    });
  });
});

describe("rule: charges-not-consumed", () => {
  it("flags an item whose actions never spend its charges", () => {
    const findings = auditAction(item({ key: "charges", consumed: false, actionCount: 1 }));
    expect(findings.map((f) => f.rule)).toEqual(["charges-not-consumed"]);
    expect(findings[0].fixes).toEqual(["consumeCharge"]);
  });

  it("offers no automatic fix when it is unclear which action should spend the charge", () => {
    expect(auditAction(item({ key: "charges", consumed: false, actionCount: 2 }))[0].fixes).toEqual([]);
  });

  it("is quiet when an action already spends the charge, and for items without counters", () => {
    expect(auditAction(item({ key: "charges", consumed: true, actionCount: 1 }))).toEqual([]);
    expect(auditAction(item())).toEqual([]);
  });
});
