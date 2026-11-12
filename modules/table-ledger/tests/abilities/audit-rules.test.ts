import { describe, expect, it } from "vitest";
import {
  ApplyButtonsTo,
  applyTargetCount,
  auditAction,
  buildReport,
  htmlToText,
  instructsAttack,
  needsTarget,
  normaliseAction,
  usesWeaponStrike,
  type RawAction,
} from "../../src/abilities/audit-rules";

const action = (raw: Partial<RawAction>) =>
  normaliseAction({
    name: "Action",
    descriptionHtml: "",
    activationType: "none",
    damageFormula: null,
    damageType: null,
    ...raw,
  });

const rules = (raw: Partial<RawAction>) => auditAction(action(raw)).map((f) => f.rule);

describe("normaliseAction", () => {
  it("strips HTML and blank formulas", () => {
    const a = action({ descriptionHtml: "<p>Make a <strong>melee</strong>&nbsp;attack.</p>", damageFormula: "  " });
    expect(a.description).toBe("Make a melee attack.");
    expect(a.damageFormula).toBeNull();
  });

  it("detects a defence target in the description", () => {
    expect(action({ descriptionHtml: "<p>Make an Intimidation test against the target's Spiritual defense.</p>" }).hasDefenceTarget).toBe(true);
    expect(action({ descriptionHtml: "<p>Test against a foe's Physical defence.</p>" }).hasDefenceTarget).toBe(true);
    expect(action({ descriptionHtml: "<p>You gain +2 to your Physical Defense.</p>" }).hasDefenceTarget).toBe(true);
    expect(action({ descriptionHtml: "<p>Gain a focus.</p>" }).hasDefenceTarget).toBe(false);
  });

  it("htmlToText handles empty input", () => {
    expect(htmlToText(null)).toBe("");
  });
});

describe("rule (a): skill test + damage that is not an attack", () => {
  it("flags a heal formula by damage type", () => {
    const findings = auditAction(
      action({
        name: "Field Medicine",
        descriptionHtml: "<p>Make a DC 15 Medicine test. On a success, the target recovers health.</p>",
        activationType: "skill_test",
        damageFormula: "1d4+@mods.med",
        damageType: "heal",
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("skill-test-damage-not-attack");
    expect(findings[0].reason).toBe("skill-test-heal");
    // Utility would drop the DC test itself; clearing the formula keeps it.
    expect(findings[0].fixes).toEqual(["clearDamage"]);
  });

  it("uses heal wording only when the damage type is unset", () => {
    expect(
      auditAction(action({ name: "Mend", descriptionHtml: "<p>You heal an ally.</p>", activationType: "skill_test", damageFormula: "2d4" })).map(
        (f) => f.reason,
      ),
    ).toEqual(["skill-test-heal"]);
    // An adversary attack whose text mentions healing is still an attack.
    expect(
      rules({
        name: "Strike: Claws",
        descriptionHtml: "<p>Wounds from these claws can't heal naturally.</p>",
        activationType: "skill_test",
        damageFormula: "1d6",
        damageType: "keen",
      }),
    ).toEqual([]);
  });

  it("flags damage with no attack wording", () => {
    const findings = auditAction(
      action({ name: "Cheap Shot", descriptionHtml: "<p>The enemy becomes Disoriented.</p>", activationType: "skill_test", damageFormula: "1d4" }),
    );
    expect(findings.map((f) => f.reason)).toEqual(["skill-test-damage-not-attack"]);
  });

  it("does not flag a weapon strike", () => {
    expect(
      rules({
        name: "Strike: Longsword",
        descriptionHtml: "<p>A long, straight blade.</p>",
        activationType: "skill_test",
        damageFormula: "1d8",
        damageType: "keen",
      }),
    ).toEqual([]);
  });

  it("does not flag an attack described by wording or a defence", () => {
    expect(
      rules({ name: "Lunge", descriptionHtml: "<p>Make a melee attack.</p>", activationType: "skill_test", damageFormula: "1d6", damageType: "keen" }),
    ).toEqual([]);
    expect(
      rules({
        name: "Mind Spike",
        descriptionHtml: "<p>Test Lightweaving against the target's Cognitive defense.</p>",
        activationType: "skill_test",
        damageFormula: "2d4",
        damageType: "spirit",
      }),
    ).toEqual([]);
  });

  it("does not flag a skill test with no damage", () => {
    expect(rules({ name: "Bind", descriptionHtml: "<p>You heal nothing.</p>", activationType: "skill_test" })).toEqual([]);
  });
});

describe("utility actions are never audit findings", () => {
  it("does not flag attack wording or rider damage (weapon Strike talents)", () => {
    expect(
      rules({ name: "Startling Blow", descriptionHtml: "<p>Make an unarmed melee attack against a target.</p>", activationType: "utility" }),
    ).toEqual([]);
    expect(
      rules({ name: "Fatal Thrust", descriptionHtml: "<p>Deal extra damage.</p>", activationType: "utility", damageFormula: "4d4", damageType: "keen" }),
    ).toEqual([]);
  });
});

describe("usesWeaponStrike (chat hint)", () => {
  it("matches Utility actions that tell the user to attack", () => {
    expect(usesWeaponStrike(action({ descriptionHtml: "<p>Make an unarmed melee attack against a target.</p>", activationType: "utility" }))).toBe(true);
    expect(usesWeaponStrike(action({ descriptionHtml: "<p>Roll an attack roll with advantage.</p>", activationType: "utility" }))).toBe(true);
  });

  it("ignores trigger clauses, non-attack utilities and other activations", () => {
    expect(instructsAttack("When you make an attack, add 1d4 damage.")).toBe(false);
    expect(instructsAttack("After an enemy makes an attack against you, gain focus.")).toBe(false);
    expect(usesWeaponStrike(action({ descriptionHtml: "<p>Whenever you make a melee attack, gain advantage.</p>", activationType: "utility" }))).toBe(false);
    expect(usesWeaponStrike(action({ descriptionHtml: "<p>Recover 1 focus.</p>", activationType: "utility" }))).toBe(false);
    expect(usesWeaponStrike(action({ descriptionHtml: "<p>Make a melee attack.</p>", activationType: "skill_test" }))).toBe(false);
  });
});

describe("applyTargetCount mirrors getApplyTargets", () => {
  it.each([
    [ApplyButtonsTo.SelectedOnly, 0, 2, 0],
    [ApplyButtonsTo.SelectedOnly, 1, 0, 1],
    [ApplyButtonsTo.TargetedOnly, 3, 0, 0],
    [ApplyButtonsTo.TargetedOnly, 0, 2, 2],
    [ApplyButtonsTo.SelectedAndTargeted, 1, 2, 3],
    [ApplyButtonsTo.PrioritiseSelected, 1, 2, 1],
    [ApplyButtonsTo.PrioritiseSelected, 0, 2, 2],
    [ApplyButtonsTo.PrioritiseTargeted, 1, 2, 2],
    [ApplyButtonsTo.PrioritiseTargeted, 1, 0, 1],
    [ApplyButtonsTo.PrioritiseTargeted, 0, 0, 0],
  ])("setting %i, %i selected, %i targeted → %i", (setting, selected, targeted, expected) => {
    expect(applyTargetCount(setting, selected, targeted)).toBe(expected);
  });
});

describe("buildReport", () => {
  it("renders a markdown table row per finding", () => {
    const md = buildReport(
      [
        {
          name: "Field | Medicine",
          location: "Kel › Field Medicine",
          uuid: "Actor.a.Item.b.Item.c",
          activationType: "skill_test",
          damageFormula: "@skills.med.rank",
          damageType: "heal",
          findings: auditAction(
            action({ activationType: "skill_test", damageFormula: "@skills.med.rank", damageType: "heal" }),
          ),
        },
      ],
      { system: "cosmere-rpg 3.1.0", foundry: "13.351" },
    );
    expect(md).toContain("System: cosmere-rpg 3.1.0 · Foundry: 13.351 · Findings: 1");
    expect(md).toContain("| Field \\| Medicine | Kel › Field Medicine | skill_test | @skills.med.rank (heal) |");
    expect(md).toContain("clear the damage formula");
  });

  it("says when there are no findings", () => {
    expect(buildReport([], { system: "s", foundry: "f" })).toContain("No findings.");
  });
});
