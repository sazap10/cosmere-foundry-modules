// Pure trigger logic: which talents fire on a use, what the outcome was, what
// the follow-up costs, and when an offer or a once-per-round limit lapses.
// No Foundry globals. The adapter describes a use as a `UseDescription` and
// supplies rules; everything here works on those shapes.

export type TriggerKind =
  /** A weapon attack: the Strike action or any weapon item. */
  | "weapon-attack"
  | "melee-weapon-attack"
  /** Any action that compares a d20 against a defence. */
  | "attack"
  /** One action, by system id. */
  | "action"
  /** A heal given to another character. */
  | "heal-other";

export type TriggerOutcome = "any" | "hit" | "miss";
export type TriggerEffect = "follow-up" | "graze" | "focus-spend" | "replacement-heal" | "heal-bonus";
export type TriggerCost = "normal" | "waived" | "waived-on-miss";
export type TriggerLimit = "none" | "round";
export type Defence = "phy" | "cog" | "spi";

export interface TriggerRule {
  /** Stable id; limits are recorded against it. */
  id: string;
  name: string;
  trigger: { kind: TriggerKind; actionId?: string };
  outcome: TriggerOutcome;
  /** Which defence decides the outcome; defaults to the use's own, then Physical for a weapon. */
  defence?: Defence;
  effect: TriggerEffect;
  /** System id of the item the effect uses (follow-up) or the item whose heal replaces (replacement-heal). */
  followUp?: string;
  cost: TriggerCost;
  limit: TriggerLimit;
  /** Optional rules are offered; the others are applied without asking. */
  optional: boolean;
  /** Shown with the offer, e.g. a condition the module can't check. */
  note?: string;
  /** Focus the effect spends (focus-spend). */
  amount?: number;
}

export interface UseTarget {
  uuid: string;
  def: Record<Defence, number>;
}

/** One use of an action, as the adapter read it from the system's card. */
export interface UseDescription {
  /** The used item's system id, when it has one. */
  actionId?: string;
  weapon: boolean;
  melee: boolean;
  /** A d20 is compared against a defence. */
  attack: boolean;
  healsOther: boolean;
  d20: number | null;
  /** Targets the system recorded on the card. */
  targets: UseTarget[];
  /** Defences of a target the target picker supplied when the card recorded none (off-scene allies). */
  pickedDef?: Record<Defence, number>;
  /** The defence the action's description names, when it names one. */
  defence?: Defence;
}

export type Outcome = "hit" | "miss";

/** Hit when the d20 total meets any target's defence (the comparison the system's card shows); null when it can't be told. */
export function computeOutcome(use: UseDescription, rule: TriggerRule): Outcome | null {
  const defence = rule.defence ?? use.defence ?? (use.weapon ? "phy" : undefined);
  if (!defence || use.d20 === null) return null;
  const defs = use.targets.length ? use.targets.map((t) => t.def) : use.pickedDef ? [use.pickedDef] : [];
  if (!defs.length) return null;
  return defs.some((def) => use.d20! >= def[defence]) ? "hit" : "miss";
}

function matchesKind(use: UseDescription, rule: TriggerRule): boolean {
  switch (rule.trigger.kind) {
    case "weapon-attack":
      return use.weapon;
    case "melee-weapon-attack":
      return use.weapon && use.melee;
    case "attack":
      return use.attack;
    case "action":
      return !!rule.trigger.actionId && use.actionId === rule.trigger.actionId;
    case "heal-other":
      return use.healsOther;
  }
}

const dependsOnOutcome = (rule: TriggerRule) => rule.outcome !== "any" || rule.cost === "waived-on-miss";

export interface Offer {
  rule: TriggerRule;
  outcome: Outcome | null;
  /** The cost version to use: waived, or the normal cost the system's consume dialog charges. */
  cost: "normal" | "waived";
}

export interface Matches {
  offers: Offer[];
  /** Mandatory rules: applied, not offered. */
  riders: TriggerRule[];
  /** Some matching rule depends on an outcome that can't be computed and wasn't answered. */
  askOutcome: boolean;
}

/**
 * Optional rules become offers; mandatory ones are riders. A rule that depends
 * on the outcome waits for it: computed from the card, or `answer` from the user.
 * Rules sharing an id (one talent with two triggers) offer at most once per use.
 */
export function matchTriggers(use: UseDescription, rules: TriggerRule[], answer?: Outcome): Matches {
  const result: Matches = { offers: [], riders: [], askOutcome: false };
  for (const rule of rules) {
    if (!matchesKind(use, rule)) continue;
    if (!rule.optional) {
      result.riders.push(rule);
      continue;
    }
    if (result.offers.some((offer) => offer.rule.id === rule.id)) continue;
    let outcome: Outcome | null = null;
    if (dependsOnOutcome(rule)) {
      outcome = answer ?? computeOutcome(use, rule);
      if (!outcome) {
        result.askOutcome = true;
        continue;
      }
      if (rule.outcome !== "any" && rule.outcome !== outcome) continue;
    }
    result.offers.push({ rule, outcome, cost: rule.cost === "waived" || (rule.cost === "waived-on-miss" && outcome === "miss") ? "waived" : "normal" });
  }
  return result;
}

const KINDS: readonly TriggerKind[] = ["weapon-attack", "melee-weapon-attack", "attack", "action", "heal-other"];
const OUTCOMES: readonly TriggerOutcome[] = ["any", "hit", "miss"];
const EFFECTS: readonly TriggerEffect[] = ["follow-up", "graze", "focus-spend", "replacement-heal", "heal-bonus"];
const COSTS: readonly TriggerCost[] = ["normal", "waived", "waived-on-miss"];
const LIMITS: readonly TriggerLimit[] = ["none", "round"];
const DEFENCES: readonly Defence[] = ["phy", "cog", "spi"];

export const NOTE_LIMIT = 200;

export type ParsedTag = { ok: true; rule: TriggerRule } | { ok: false; reason: string };

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Check a trigger tag read from an item flag. Free text is bounded; it is shown as plain text by the UI. */
export function parseTag(raw: unknown): ParsedTag {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const t = raw as Record<string, unknown>;
  const trigger = t.trigger as { kind?: unknown; actionId?: unknown } | undefined;
  if (!oneOf(KINDS, trigger?.kind)) return { ok: false, reason: "unknown trigger" };
  if (trigger.kind === "action" && (typeof trigger.actionId !== "string" || !trigger.actionId)) {
    return { ok: false, reason: "a named-action trigger needs an action id" };
  }
  if (!oneOf(OUTCOMES, t.outcome)) return { ok: false, reason: "unknown outcome" };
  if (!oneOf(EFFECTS, t.effect)) return { ok: false, reason: "unknown effect" };
  if (!oneOf(COSTS, t.cost)) return { ok: false, reason: "unknown cost" };
  if (!oneOf(LIMITS, t.limit)) return { ok: false, reason: "unknown limit" };
  if (t.defence !== undefined && !oneOf(DEFENCES, t.defence)) return { ok: false, reason: "unknown defence" };
  const followUp = typeof t.followUp === "string" ? t.followUp.trim() : "";
  if ((t.effect === "follow-up" || t.effect === "replacement-heal") && !followUp) {
    return { ok: false, reason: "this effect needs a follow-up item" };
  }
  const note = typeof t.note === "string" ? t.note.trim() : "";
  if (note.length > NOTE_LIMIT) return { ok: false, reason: `note is longer than ${NOTE_LIMIT} characters` };
  const amount = t.amount === undefined ? undefined : Number(t.amount);
  if (amount !== undefined && !(Number.isInteger(amount) && amount >= 0 && amount <= 20)) {
    return { ok: false, reason: "amount must be a whole number from 0 to 20" };
  }
  return {
    ok: true,
    rule: {
      id: typeof t.id === "string" && t.id ? t.id : "tag",
      name: typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 80) : "Trigger",
      trigger: { kind: trigger.kind, ...(trigger.kind === "action" ? { actionId: trigger.actionId as string } : {}) },
      outcome: t.outcome,
      ...(t.defence ? { defence: t.defence } : {}),
      effect: t.effect,
      ...(followUp ? { followUp } : {}),
      cost: t.cost,
      limit: t.limit,
      optional: t.optional !== false,
      ...(note ? { note } : {}),
      ...(amount !== undefined ? { amount } : {}),
    },
  };
}

/** An item's trigger rules: a valid tag replaces the built-in ones; an invalid tag leaves them and says why. */
export function rulesFor(
  item: { systemId?: string; tag: unknown },
  builtIns: Record<string, TriggerRule[]>,
): { rules: TriggerRule[]; invalid?: string } {
  const builtIn = (item.systemId && builtIns[item.systemId]) || [];
  if (item.tag === undefined || item.tag === null) return { rules: builtIn };
  const parsed = parseTag(item.tag);
  return parsed.ok ? { rules: [parsed.rule] } : { rules: builtIn, invalid: parsed.reason };
}

export interface CombatPoint {
  id: string;
  round: number;
}

/** A once-per-round rule is spent only in the combat and round it was last used in; never outside combat. */
export function limitSpent(rule: TriggerRule, record: { combatId: string; round: number } | null, combat: CombatPoint | null): boolean {
  if (rule.limit !== "round" || !record || !combat) return false;
  return record.combatId === combat.id && record.round === combat.round;
}

/** A card posted in combat lapses when that combat ends or its round changes; one posted outside combat never lapses. */
export function offerExpired(posted: { combatId: string; round: number } | null, combat: CombatPoint | null): boolean {
  if (!posted) return false;
  return !combat || combat.id !== posted.combatId || combat.round !== posted.round;
}
