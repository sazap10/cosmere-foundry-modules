import { describe, expect, it } from "vitest";
import { BUILT_IN_RULES } from "../../src/adapters/cosmere/trigger-rules";
import { matchTriggers, parseTag, type UseDescription } from "../../src/abilities/triggers";

const rulesOf = (...ids: string[]) => ids.flatMap((id) => BUILT_IN_RULES[id] ?? []);

const strike = (d20: number, over: Partial<UseDescription> = {}): UseDescription => ({
  actionId: "strike",
  weapon: true,
  melee: true,
  attack: true,
  healsOther: false,
  d20,
  targets: [{ uuid: "Actor.enemy", def: { phy: 12, cog: 10, spi: 14 } }],
  ...over,
});

describe("built-in trigger rules", () => {
  it("offers Combat Coordination's Decisive Command free on a missed Strike and normally on a hit", () => {
    const missed = matchTriggers(strike(8), rulesOf("combat-coordination"));
    expect(missed.offers.map((o) => [o.rule.followUp, o.cost])).toEqual([["decisive-command", "waived"]]);
    const hit = matchTriggers(strike(15), rulesOf("combat-coordination"));
    expect(hit.offers.map((o) => [o.rule.followUp, o.cost])).toEqual([["decisive-command", "normal"]]);
  });

  it("offers Practical Demonstration after a successful attack, once, even when two of its rules match", () => {
    const gainAdvantage: UseDescription = {
      actionId: "gain_advantage",
      weapon: false,
      melee: false,
      attack: true,
      healsOther: false,
      defence: "cog",
      d20: 18,
      targets: [{ uuid: "Actor.enemy", def: { phy: 12, cog: 14, spi: 14 } }],
    };
    const offers = matchTriggers(gainAdvantage, rulesOf("practical-demonstration")).offers;
    expect(offers).toHaveLength(1);
    expect(offers[0].rule.followUp).toBe("rousing-presence");
    expect(matchTriggers({ ...gainAdvantage, d20: 5 }, rulesOf("practical-demonstration")).offers).toHaveLength(0);
  });

  it("offers Combat Training's graze only on a missed weapon attack", () => {
    expect(matchTriggers(strike(5), rulesOf("combat-training")).offers.map((o) => o.rule.effect)).toEqual(["graze"]);
    expect(matchTriggers(strike(20), rulesOf("combat-training")).offers).toHaveLength(0);
  });

  it("offers Binding Strike only for a melee hit", () => {
    expect(matchTriggers(strike(15), rulesOf("binding-strike")).offers).toHaveLength(1);
    expect(matchTriggers(strike(15, { melee: false }), rulesOf("binding-strike")).offers).toHaveLength(0);
    expect(matchTriggers(strike(3), rulesOf("binding-strike")).offers).toHaveLength(0);
  });

  it("treats Swift Healer as a rider on a heal given to another character", () => {
    const heal: UseDescription = { actionId: "field-medicine", weapon: false, melee: false, attack: false, healsOther: true, d20: null, targets: [] };
    const result = matchTriggers(heal, rulesOf("swift-healer"));
    expect(result.offers).toEqual([]);
    expect(result.riders.map((r) => r.id)).toEqual(["swift-healer"]);
  });

  it("offers Swift Regeneration on Regenerate", () => {
    const regenerate: UseDescription = { actionId: "regenerate", weapon: false, melee: false, attack: false, healsOther: false, d20: null, targets: [] };
    expect(matchTriggers(regenerate, rulesOf("swift-regeneration")).offers.map((o) => o.rule.effect)).toEqual(["replacement-heal"]);
  });

  it("offers Shadowing only on a success against Spiritual defence", () => {
    const test = (d20: number) => matchTriggers(strike(d20, { weapon: false }), rulesOf("shadowing"));
    expect(test(14).offers.map((o) => o.rule.amount)).toEqual([3]);
    expect(test(13).offers).toHaveLength(0);
  });

  it("only lists rules the tag parser accepts", () => {
    for (const rules of Object.values(BUILT_IN_RULES)) {
      for (const rule of rules) expect(parseTag(rule).ok, rule.id).toBe(true);
    }
  });
});
