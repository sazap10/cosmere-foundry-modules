// Built-in trigger rules for the party's own-use talents, keyed by the talent's
// `system.id` (cosmere-rpg 3.1.2 data). Each rule encodes the talent's text:
//
// - Combat Coordination: "After you use the Strike action, use Decisive Command
//   as 0. If your Strike didn't hit, you also don't have to spend the usual
//   focus for Decisive Command."
// - Practical Demonstration: "After you succeed on a test to attack or Gain
//   Advantage, you can use your Rousing Presence as 0."
// - Combat Training: "Once per round, when you miss on a weapon attack, you can
//   graze one target without spending focus."
// - Binding Strike: "After you hit with a melee attack, you can spend 0 or 2
//   focus to use Adhesion ... without spending an action."
// - Swift Healer: "When you use an ability that restores health to another
//   character, they recover additional health equal to your ranks in Medicine."
// - Swift Regeneration: "When you use Regenerate, instead of recovering the
//   normal amount of health, you can recover health equal to [the talent's
//   formula]."
// - Shadowing: "when you succeed on a test against an enemy's Spiritual defense
//   while you're in cover ..., you can spend 3 focus to designate that target
//   as your quarry."
//
// "As 0" means no action cost, which the system never spends; only the focus
// side of a cost is modelled. Plot-die talents (Opportunist, Sure Outcome) are
// not use triggers and are not listed.
import { MODULE_ID } from "../../constants";
import { rulesFor, TAG_FLAG, type TriggerRule } from "../../abilities/triggers";

const base = { outcome: "any", limit: "none", optional: true, cost: "normal" } as const;

export const BUILT_IN_RULES: Record<string, TriggerRule[]> = {
  "combat-coordination": [
    {
      ...base,
      id: "combat-coordination",
      name: "Combat Coordination",
      trigger: { kind: "weapon-attack" },
      effect: "follow-up",
      followUp: "decisive-command",
      cost: "waived-on-miss",
    },
  ],
  "practical-demonstration": [
    {
      ...base,
      id: "practical-demonstration",
      name: "Practical Demonstration",
      trigger: { kind: "attack" },
      outcome: "hit",
      effect: "follow-up",
      followUp: "rousing-presence",
      cost: "waived",
    },
    {
      ...base,
      id: "practical-demonstration",
      name: "Practical Demonstration",
      trigger: { kind: "action", actionId: "gain_advantage" },
      outcome: "hit",
      effect: "follow-up",
      followUp: "rousing-presence",
      cost: "waived",
    },
  ],
  "combat-training": [
    {
      ...base,
      id: "combat-training",
      name: "Combat Training",
      trigger: { kind: "weapon-attack" },
      outcome: "miss",
      effect: "graze",
      cost: "waived",
      limit: "round",
    },
  ],
  "binding-strike": [
    {
      ...base,
      id: "binding-strike",
      name: "Binding Strike",
      trigger: { kind: "melee-weapon-attack" },
      outcome: "hit",
      effect: "follow-up",
      followUp: "adh",
      note: "At least one target must be an object the target is holding or wearing. Spend 0 or 2 focus in the consume dialog.",
    },
  ],
  "swift-healer": [
    {
      ...base,
      id: "swift-healer",
      name: "Swift Healer",
      trigger: { kind: "heal-other" },
      effect: "heal-bonus",
      optional: false,
    },
  ],
  "swift-regeneration": [
    {
      ...base,
      id: "swift-regeneration",
      name: "Swift Regeneration",
      trigger: { kind: "action", actionId: "regenerate" },
      effect: "replacement-heal",
      followUp: "swift-regeneration",
    },
  ],
  shadowing: [
    {
      ...base,
      id: "shadowing",
      name: "Shadowing",
      trigger: { kind: "attack" },
      outcome: "hit",
      defence: "spi",
      effect: "focus-spend",
      amount: 3,
      note: "Only if you are in cover, or your target's senses are obscured.",
    },
  ],
};

/** An item's trigger rules: its tag if valid, else the built-in rules for its system id. */
export function rulesOfItem(item: { system?: { id?: string }; getFlag?(scope: string, key: string): unknown }): { rules: TriggerRule[]; invalid?: string } {
  return rulesFor({ systemId: item.system?.id, tag: item.getFlag?.(MODULE_ID, TAG_FLAG) }, BUILT_IN_RULES);
}
