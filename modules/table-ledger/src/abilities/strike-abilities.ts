// Abilities whose text says "make a weapon attack" and adds an effect, keyed by
// the action's system id (cosmere-rpg 3.1.2 and Stormlight Handbook data). In
// the system they are Utility actions: the card is the effect and the roll is
// left to the player's weapon Strike. Each entry encodes the ability's text:
//
// - Startling Blow: unarmed or improvised weapon attack vs Cognitive; on a hit
//   or graze the target is Surprised until the end of your next turn.
// - Devastating Blow: melee weapon attack vs Physical, extra damage dice.
// - Fatal Thrust: light melee weapon attack vs Cognitive of an unaware target,
//   extra damage dice; two advantages with a Discreet weapon.
// - Feinting Strike: melee weapon attack vs Cognitive; on a hit the target loses
//   a reaction and focus equal to your Intimidation ranks, half on a graze.
// - Cheap Shot: unarmed attack with Thievery vs Cognitive, raising the stakes;
//   on a hit the target is Stunned until the end of their next turn.
// - Subtle Takedown: unarmed attack with Insight vs Cognitive of an unaware
//   target, raising the stakes; on a hit they can't communicate.
// - Tagging Shot: ranged weapon attack vs Physical; on a hit or graze the target
//   becomes your quarry.
// - Wit's End: melee weapon attack vs Cognitive of a target with 0 focus, extra
//   damage dice, ignores deflect, can't graze.
// - Reactive Strike, Flying Ace: a melee weapon attack, nothing added.
//
// The extra dice are the action's own damage formula. Pure: no Foundry globals.
import type { Defence } from "./triggers";

export type WeaponKind = "unarmed" | "improvised" | "melee" | "light-melee" | "ranged";

/** What the weapon picker knows about one option. */
export interface WeaponInfo {
  kind: "unarmed" | "improvised" | "weapon";
  melee: boolean;
  ranged: boolean;
  light: boolean;
  discreet: boolean;
}

export type RiderOn = "hit" | "hit-or-graze";

export type Rider =
  /** A system status; it ends at the end of the attacker's or the target's next turn. */
  | { kind: "condition"; status: string; on: RiderOn; until: "attacker-turn" | "target-turn" }
  /** The target loses focus equal to the attacker's ranks in `skill` on a hit, half (rounded up) on a graze. */
  | { kind: "focus-loss"; skill: string }
  /** An effect the module can't apply; shown on the card. Text: `StrikeAbilities.Rider.<id>`. */
  | { kind: "note"; on: RiderOn };

export interface StrikeAbility {
  weapons: WeaponKind[];
  defence: Defence;
  /** Skill the attack is made with instead of the weapon's. */
  skill?: string;
  raiseStakes?: boolean;
  /** Add the action's own damage formula to the weapon's; `extraDice` stands in when the action has none (older item data). */
  extraDamage?: boolean;
  extraDice?: string;
  discreetAdvantage?: boolean;
  noGraze?: boolean;
  riders: Rider[];
  /** A requirement the module can't check. Text: `StrikeAbilities.Note.<id>`. */
  note?: boolean;
}

const melee: StrikeAbility = { weapons: ["melee"], defence: "phy", riders: [] };

export const STRIKE_ABILITIES: Record<string, StrikeAbility> = {
  "startling-blow": {
    weapons: ["unarmed", "improvised"],
    defence: "cog",
    riders: [{ kind: "condition", status: "surprised", on: "hit-or-graze", until: "attacker-turn" }],
  },
  "devastating-blow": { weapons: ["melee"], defence: "phy", extraDamage: true, extraDice: "(max(2, @tier))d8", riders: [] },
  "fatal-thrust": {
    weapons: ["light-melee"],
    defence: "cog",
    extraDamage: true,
    extraDice: "(max(4, @tier * 2))d4",
    discreetAdvantage: true,
    note: true,
    riders: [],
  },
  "feinting-strike": { weapons: ["melee"], defence: "cog", riders: [{ kind: "focus-loss", skill: "inm" }, { kind: "note", on: "hit" }] },
  "cheap-shot": {
    weapons: ["unarmed"],
    defence: "cog",
    skill: "thv",
    raiseStakes: true,
    riders: [{ kind: "condition", status: "stunned", on: "hit", until: "target-turn" }],
  },
  "subtle-takedown": { weapons: ["unarmed"], defence: "cog", skill: "ins", raiseStakes: true, note: true, riders: [{ kind: "note", on: "hit" }] },
  "tagging-shot": { weapons: ["ranged"], defence: "phy", riders: [{ kind: "note", on: "hit-or-graze" }] },
  "wits-end": {
    weapons: ["melee"],
    defence: "cog",
    extraDamage: true,
    extraDice: "(4 + max((@tier - 2) * 2, 0))d6",
    noGraze: true,
    note: true,
    riders: [],
  },
  "reactive-strike": melee,
  // Characters made before cosmere-rpg 3 carry the old id.
  reactive_strike: melee,
  "flying-ace": melee,
};

export function weaponFits(ability: StrikeAbility, weapon: WeaponInfo): boolean {
  return ability.weapons.some((kind) => {
    switch (kind) {
      case "unarmed":
        return weapon.kind === "unarmed";
      case "improvised":
        return weapon.kind === "improvised";
      case "melee":
        return weapon.melee;
      case "light-melee":
        return weapon.melee && weapon.light;
      case "ranged":
        return weapon.ranged;
    }
  });
}

export function strikeFormula(weaponFormula: string, extra: string | null | undefined): string {
  return extra ? `${weaponFormula} + ${extra}` : weaponFormula;
}

export type StrikeResult = "hit" | "graze";

/** The riders a hit or a graze applies. A graze applies only "hit or graze" riders, and none when the ability can't graze. */
export function ridersFor(ability: StrikeAbility, result: StrikeResult, cantGraze = false): Rider[] {
  if (result === "graze" && (ability.noGraze || cantGraze)) return [];
  return ability.riders.filter((r) => r.kind === "focus-loss" || result === "hit" || r.on === "hit-or-graze");
}

export function focusLoss(ranks: number, result: StrikeResult): number {
  return result === "hit" ? ranks : Math.ceil(ranks / 2);
}

/** Hit when the d20 total meets the defence (the comparison the system's card shows); null when it can't be told. */
export function attackOutcome(d20: number | null, defence: number | undefined): "hit" | "miss" | null {
  if (d20 === null || defence === undefined) return null;
  return d20 >= defence ? "hit" : "miss";
}

export interface TurnPoint {
  round: number;
  turn: number;
}

/**
 * "Until the end of <combatant>'s next turn": the turn that just ended was
 * theirs and came after the effect was applied. Applied during their own turn,
 * that turn's end doesn't count; their turn in a later round does.
 */
export function turnEndExpires(applied: TurnPoint, prior: TurnPoint & { combatantId?: string | null }, combatantId: string): boolean {
  if (prior.combatantId !== combatantId) return false;
  return prior.round > applied.round || (prior.round === applied.round && prior.turn > applied.turn);
}

export type AdvantageMode = "advantage" | "disadvantage" | "none";

/** One disadvantage added to a roll: it cancels an advantage, else the roll has disadvantage. */
export function addDisadvantage(mode: AdvantageMode | undefined): AdvantageMode {
  return mode === "advantage" ? "none" : "disadvantage";
}
