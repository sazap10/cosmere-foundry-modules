import { describe, expect, it } from "vitest";
import {
  computeOutcome,
  defenceFromText,
  describeCard,
  limitSpent,
  matchTriggers,
  offerExpired,
  parseTag,
  rulesFor,
  type TriggerCardState,
  type TriggerRule,
  type UseDescription,
} from "../../src/abilities/triggers";

const rule = (over: Partial<TriggerRule> = {}): TriggerRule => ({
  id: "r",
  name: "Rule",
  trigger: { kind: "weapon-attack" },
  outcome: "any",
  effect: "follow-up",
  followUp: "decisive-command",
  cost: "normal",
  limit: "none",
  optional: true,
  ...over,
});

const use = (over: Partial<UseDescription> = {}): UseDescription => ({
  actionId: "strike",
  weapon: true,
  melee: true,
  attack: true,
  healsOther: false,
  d20: 15,
  targets: [{ uuid: "Actor.a", def: { phy: 15, cog: 10, spi: 10 } }],
  ...over,
});

describe("computeOutcome", () => {
  it("compares the d20 total with the target's Physical defence for a weapon attack", () => {
    expect(computeOutcome(use({ d20: 15 }), rule())).toBe("hit");
    expect(computeOutcome(use({ d20: 14 }), rule())).toBe("miss");
  });

  it("counts a hit on any target as a hit", () => {
    const targets = [
      { uuid: "Actor.a", def: { phy: 18, cog: 10, spi: 10 } },
      { uuid: "Actor.b", def: { phy: 12, cog: 10, spi: 10 } },
    ];
    expect(computeOutcome(use({ d20: 13, targets }), rule())).toBe("hit");
  });

  it("is unknown with no targets and no picked target", () => {
    expect(computeOutcome(use({ targets: [] }), rule())).toBeNull();
  });

  it("uses the picked target's defence when the card recorded none", () => {
    const pickedDef = { phy: 20, cog: 10, spi: 10 };
    expect(computeOutcome(use({ targets: [], pickedDef, d20: 19 }), rule())).toBe("miss");
  });

  it("uses the defence the action's description names for a non-weapon attack", () => {
    const u = use({ weapon: false, defence: "spi", d20: 11, targets: [{ uuid: "Actor.a", def: { phy: 20, cog: 20, spi: 11 } }] });
    expect(computeOutcome(u, rule({ trigger: { kind: "attack" } }))).toBe("hit");
  });

  it("is unknown when a non-weapon attack names no defence", () => {
    expect(computeOutcome(use({ weapon: false }), rule({ trigger: { kind: "attack" } }))).toBeNull();
  });

  it("lets a rule's own defence override the use's", () => {
    const u = use({ d20: 12, targets: [{ uuid: "Actor.a", def: { phy: 20, cog: 20, spi: 12 } }] });
    expect(computeOutcome(u, rule({ defence: "spi" }))).toBe("hit");
  });

  it("is unknown when the card has no d20", () => {
    expect(computeOutcome(use({ d20: null }), rule())).toBeNull();
  });
});

describe("matchTriggers", () => {
  it("offers Decisive Command waived on a miss and normal on a hit", () => {
    const coordination = rule({ cost: "waived-on-miss" });
    const missed = matchTriggers(use({ d20: 5 }), [coordination]);
    expect(missed.offers.map((o) => o.cost)).toEqual(["waived"]);
    const hit = matchTriggers(use({ d20: 18 }), [coordination]);
    expect(hit.offers.map((o) => o.cost)).toEqual(["normal"]);
  });

  it("asks for the outcome instead of offering a hit-dependent rule when it can't be computed", () => {
    const result = matchTriggers(use({ targets: [] }), [rule({ cost: "waived-on-miss" })]);
    expect(result.offers).toEqual([]);
    expect(result.askOutcome).toBe(true);
  });

  it("offers the rule once the user answers", () => {
    const result = matchTriggers(use({ targets: [] }), [rule({ cost: "waived-on-miss" })], "miss");
    expect(result.askOutcome).toBe(false);
    expect(result.offers.map((o) => o.cost)).toEqual(["waived"]);
  });

  it("does not ask when no matching rule depends on the outcome", () => {
    const result = matchTriggers(use({ targets: [] }), [rule()]);
    expect(result.askOutcome).toBe(false);
    expect(result.offers).toHaveLength(1);
  });

  it("offers a miss-only rule on a miss and not on a hit", () => {
    const graze = rule({ outcome: "miss", effect: "graze", followUp: undefined });
    expect(matchTriggers(use({ d20: 5 }), [graze]).offers).toHaveLength(1);
    expect(matchTriggers(use({ d20: 18 }), [graze]).offers).toHaveLength(0);
  });

  it("matches a melee-only rule for a melee hit and not for a ranged one", () => {
    const binding = rule({ trigger: { kind: "melee-weapon-attack" }, outcome: "hit" });
    expect(matchTriggers(use({ melee: true, d20: 18 }), [binding]).offers).toHaveLength(1);
    expect(matchTriggers(use({ melee: false, d20: 18 }), [binding]).offers).toHaveLength(0);
  });

  it("matches a named action by its system id", () => {
    const regen = rule({ trigger: { kind: "action", actionId: "regenerate" } });
    expect(matchTriggers(use({ actionId: "regenerate", weapon: false, attack: false }), [regen]).offers).toHaveLength(1);
    expect(matchTriggers(use({ actionId: "strike" }), [regen]).offers).toHaveLength(0);
  });

  it("matches a heal given to another character, and not a self-heal", () => {
    const bonus = rule({ trigger: { kind: "heal-other" }, effect: "heal-bonus", optional: false });
    const healUse = use({ actionId: "field-medicine", weapon: false, attack: false, targets: [], d20: null });
    expect(matchTriggers({ ...healUse, healsOther: true }, [bonus]).riders).toHaveLength(1);
    expect(matchTriggers({ ...healUse, healsOther: false }, [bonus]).riders).toHaveLength(0);
  });

  it("returns mandatory rules as riders, not offers", () => {
    const result = matchTriggers(use(), [rule({ optional: false })]);
    expect(result.offers).toEqual([]);
    expect(result.riders).toHaveLength(1);
  });
});

describe("parseTag", () => {
  const valid = {
    id: "tag",
    name: "Homebrew",
    trigger: { kind: "weapon-attack" },
    outcome: "hit",
    effect: "follow-up",
    followUp: "rousing-presence",
    cost: "waived",
    limit: "none",
    optional: true,
  };

  it("accepts a complete tag", () => {
    const parsed = parseTag(valid);
    expect(parsed.ok).toBe(true);
  });

  it("rejects an unknown trigger kind with a reason", () => {
    const parsed = parseTag({ ...valid, trigger: { kind: "sneeze" } });
    expect(parsed).toMatchObject({ ok: false });
  });

  it("rejects a follow-up effect that names no follow-up", () => {
    const parsed = parseTag({ ...valid, followUp: "" });
    expect(parsed).toMatchObject({ ok: false });
  });

  it("rejects a named-action trigger with no action id", () => {
    const parsed = parseTag({ ...valid, trigger: { kind: "action" } });
    expect(parsed).toMatchObject({ ok: false });
  });

  it("rejects a note longer than the limit", () => {
    const parsed = parseTag({ ...valid, note: "x".repeat(201) });
    expect(parsed).toMatchObject({ ok: false });
  });
});

describe("rulesFor", () => {
  const builtIn = rule({ id: "built-in" });
  const tag = {
    id: "tag",
    name: "Tag",
    trigger: { kind: "weapon-attack" },
    outcome: "any",
    effect: "follow-up",
    followUp: "x",
    cost: "normal",
    limit: "none",
    optional: true,
  };

  it("uses the built-in rules for an item's system id", () => {
    expect(rulesFor({ systemId: "swift", tag: undefined }, { swift: [builtIn] }).rules).toEqual([builtIn]);
  });

  it("replaces the built-in rules with a valid tag", () => {
    const result = rulesFor({ systemId: "swift", tag }, { swift: [builtIn] });
    expect(result.rules.map((r) => r.id)).toEqual(["tag"]);
  });

  it("keeps the built-in rules and reports why when the tag is invalid", () => {
    const result = rulesFor({ systemId: "swift", tag: { ...tag, cost: "free" } }, { swift: [builtIn] });
    expect(result.rules).toEqual([builtIn]);
    expect(result.invalid).toBeTruthy();
  });

  it("returns nothing for an untagged item with no built-in rule", () => {
    expect(rulesFor({ systemId: "other", tag: undefined }, {}).rules).toEqual([]);
  });
});

describe("once-per-round limit", () => {
  const limited = rule({ limit: "round" });
  const combat = { id: "C", round: 3 };

  it("is spent only in the round and combat it was recorded in", () => {
    expect(limitSpent(limited, { combatId: "C", round: 3 }, combat)).toBe(true);
    expect(limitSpent(limited, { combatId: "C", round: 3 }, { id: "C", round: 4 })).toBe(false);
    expect(limitSpent(limited, { combatId: "OTHER", round: 3 }, combat)).toBe(false);
  });

  it("is never spent outside combat", () => {
    expect(limitSpent(limited, { combatId: "C", round: 3 }, null)).toBe(false);
  });

  it("is never spent for a rule with no limit", () => {
    expect(limitSpent(rule(), { combatId: "C", round: 3 }, combat)).toBe(false);
  });

  it("is not spent when nothing was recorded", () => {
    expect(limitSpent(limited, null, combat)).toBe(false);
  });
});

describe("offerExpired", () => {
  it("expires when the round has moved on or the combat is gone", () => {
    const posted = { combatId: "C", round: 3 };
    expect(offerExpired(posted, { id: "C", round: 3 })).toBe(false);
    expect(offerExpired(posted, { id: "C", round: 4 })).toBe(true);
    expect(offerExpired(posted, null)).toBe(true);
    expect(offerExpired(posted, { id: "D", round: 3 })).toBe(true);
  });

  it("never expires a card posted outside combat", () => {
    expect(offerExpired(null, { id: "C", round: 9 })).toBe(false);
    expect(offerExpired(null, null)).toBe(false);
  });
});

describe("describeCard", () => {
  const state = (over: Partial<TriggerCardState> = {}): TriggerCardState => ({
    sourceMessageId: "m",
    actorUuid: "Actor.me",
    actorName: "Me",
    use: use({ d20: 5 }),
    rules: [rule({ id: "graze", outcome: "miss", effect: "graze", followUp: undefined, limit: "round" })],
    labels: {},
    sources: {},
    missing: [],
    taken: [],
    posted: { combatId: "C", round: 3 },
    ...over,
  });
  const none = () => null;
  const combat = { id: "C", round: 3 };

  it("is open while nothing has used, lapsed or spent it", () => {
    expect(describeCard(state(), combat, none).offers.map((o) => o.status)).toEqual(["open"]);
  });

  it("marks an offer taken once used", () => {
    expect(describeCard(state({ taken: ["graze"] }), combat, none).offers[0].status).toBe("taken");
  });

  it("lapses with the round", () => {
    expect(describeCard(state(), { id: "C", round: 4 }, none).offers[0].status).toBe("expired");
  });

  it("is spent when a sibling card already used the once-per-round rule this round (AE8)", () => {
    const record = () => ({ combatId: "C", round: 3 });
    expect(describeCard(state(), combat, record).offers[0].status).toBe("spent");
  });

  it("is unavailable when the follow-up isn't on the character", () => {
    expect(describeCard(state({ missing: ["graze"] }), combat, none).offers[0].status).toBe("unavailable");
  });

  it("reports that the outcome is still needed instead of offering a hit-dependent rule", () => {
    const view = describeCard(state({ use: use({ targets: [] }) }), combat, none);
    expect(view).toMatchObject({ askOutcome: true, offers: [] });
    expect(describeCard(state({ use: use({ targets: [] }), answer: "miss" }), combat, none).offers).toHaveLength(1);
  });

  it("never lapses or spends a card posted and used outside combat", () => {
    const view = describeCard(state({ posted: null }), null, () => ({ combatId: "C", round: 3 }));
    expect(view.offers[0].status).toBe("open");
  });
});

describe("defenceFromText", () => {
  it("returns the one defence the text names", () => {
    expect(defenceFromText("Make a test against the target's Spiritual defense.")).toBe("spi");
    expect(defenceFromText("Roll against their Cognitive defence")).toBe("cog");
  });

  it("returns nothing when no defence or several are named", () => {
    expect(defenceFromText("Gain a focus.")).toBeUndefined();
    expect(defenceFromText("Against the Physical defense or the Cognitive defense of a target.")).toBeUndefined();
  });
});
