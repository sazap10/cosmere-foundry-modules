// Pure ability-audit logic: no Foundry globals. The adapter normalises system
// data into `NormalisedAction`; everything here works on that shape.
import type { AbilityFix, NormalisedAction } from "../adapters/types";

/**
 * Two classes of data are wrong rather than merely unhelpful.
 *
 * `skill-test-damage-not-attack`: a skill test with a damage/heal formula that
 * isn't an attack. cosmere-rpg routes every skill test + damage through
 * `rollAttack` (`isAttack: true`, compared against the target's defences), so
 * e.g. Field Medicine's DC 15 Medicine test is rolled against the ally's
 * defences. Utility actions that say "make an attack" (Reactive Strike,
 * Startling Blow) or carry rider damage (Fatal Thrust) are correct: you attack
 * with a weapon Strike and add the effect. Those get a chat hint
 * (`instructsAttack`) instead of a fix.
 *
 * `charges-not-consumed`: an item with charges or ammo whose actions have no
 * consumption entry for it, so the system never asks to spend a charge.
 */
export type RuleId = "skill-test-damage-not-attack" | "charges-not-consumed";

export interface Finding {
  rule: RuleId;
  /** Lang key suffix under `Abilities.Reason.*`. */
  reason: ReasonId;
  /** English text, used in the upstream report. */
  message: string;
  fixes: AbilityFix[];
}

export interface RawAction {
  name: string;
  descriptionHtml: string | null | undefined;
  activationType: string | null | undefined;
  damageFormula: string | null | undefined;
  damageType: string | null | undefined;
}

export const SKILL_TEST = "skill_test";
export const UTILITY = "utility";
export const HEAL_DAMAGE_TYPE = "heal";

/** Strip HTML to plain text (tags, entities, whitespace). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const DEFENCE = /\b(physical|cognitive|spiritual)\s+defen[cs]es?\b|\bagainst\s+(?:the\s+|a\s+|an\s+|its\s+|their\s+|your\s+)?(?:\w+'s?\s+)?(?:\w+\s+)?defen[cs]e\b/i;

/** The text says the test is made against a defence. */
export function mentionsDefence(text: string): boolean {
  return DEFENCE.test(text);
}

/** Normalise raw system fields into the audit shape. */
export function normaliseAction(raw: RawAction): NormalisedAction {
  const description = htmlToText(raw.descriptionHtml);
  const formula = raw.damageFormula?.trim();
  return {
    name: raw.name,
    description,
    activationType: raw.activationType ?? "none",
    damageFormula: formula ? formula : null,
    damageType: raw.damageType ?? null,
    hasDefenceTarget: mentionsDefence(description),
  };
}

const HEAL_WORDING = /\bheal(?:s|ed|ing)?\b|\b(?:recover|regain|restore)s?\s+(?:\w+\s+){0,3}?health\b/i;

/** Heal when the damage type says so; wording decides only when the type is unset. */
export function isHealing(action: NormalisedAction): boolean {
  if (action.damageType) return action.damageType === HEAL_DAMAGE_TYPE;
  return HEAL_WORDING.test(`${action.name} ${action.description}`);
}

const ATTACK_WORDING = /\battack(?:s|ed|ing)?\b|\bstrikes?\b/i;

/** Name or description reads like an attack (or says it targets a defence). */
export function hasAttackWording(action: NormalisedAction): boolean {
  return action.hasDefenceTarget || ATTACK_WORDING.test(`${action.name} ${action.description}`);
}

const MAKE_ATTACK = /\bmake\s+an?\s+(?:[\w-]+\s+){0,4}?attack\b|\battack\s+rolls?\b/gi;
const TRIGGER_BEFORE = /\b(?:when|whenever|after|before|if|once|each\s+time|the\s+next\s+time)\s+(?:you|they|it|an?\s+[\w-]+|the\s+[\w-]+|\w+)\s*$/i;

/**
 * The description tells the user to make an attack ("make a melee attack",
 * "attack roll"). Trigger clauses ("when you make an attack") don't count:
 * those describe passive riders, not this action's own roll.
 */
export function instructsAttack(text: string): boolean {
  for (const match of text.matchAll(MAKE_ATTACK)) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (!TRIGGER_BEFORE.test(before)) return true;
  }
  return false;
}

export type ReasonId = RuleId | "skill-test-heal";

export const RULE_MESSAGES: Record<ReasonId, string> = {
  "skill-test-heal":
    "Has a skill test and a healing formula, so the system rolls it as an attack against the target's defences.",
  "skill-test-damage-not-attack":
    "Has a skill test and a damage formula, so the system rolls it as an attack, but nothing in its name or description describes an attack.",
  "charges-not-consumed":
    "Has charges, but none of its actions spend them, so using it never asks to consume a charge or lowers the count.",
};

/** All findings for one action; empty when the data matches its description. */
export function auditAction(action: NormalisedAction): Finding[] {
  const findings: Finding[] = [];

  if (action.charges && !action.charges.consumed) {
    findings.push({
      rule: "charges-not-consumed",
      reason: "charges-not-consumed",
      message: RULE_MESSAGES["charges-not-consumed"],
      fixes: action.charges.actionCount === 1 ? ["consumeCharge"] : [],
    });
  }

  if (action.activationType !== SKILL_TEST || !action.damageFormula) return findings;
  if (isHealing(action)) {
    // Clearing the formula keeps the skill test (the DC roll) and drops the attack path.
    findings.push({
      rule: "skill-test-damage-not-attack",
      reason: "skill-test-heal",
      message: RULE_MESSAGES["skill-test-heal"],
      fixes: ["clearDamage"],
    });
  } else if (!hasAttackWording(action)) {
    findings.push({
      rule: "skill-test-damage-not-attack",
      reason: "skill-test-damage-not-attack",
      message: RULE_MESSAGES["skill-test-damage-not-attack"],
      fixes: ["clearDamage", "setUtility"],
    });
  }
  return findings;
}

/** A Utility action whose text tells the user to attack: it posts a card, the attack is a weapon Strike. */
export function usesWeaponStrike(action: NormalisedAction): boolean {
  return action.activationType === UTILITY && instructsAttack(action.description);
}

/** A use of this action compares a d20 against a target's defence. */
export function needsTarget(action: NormalisedAction): boolean {
  if (action.activationType !== SKILL_TEST || isHealing(action)) return false;
  return !!action.damageFormula || action.hasDefenceTarget;
}

/** cosmere-rpg `applyButtonsTo` client setting values (settings.ts TargetingOptions). */
export const ApplyButtonsTo = {
  SelectedOnly: 0,
  TargetedOnly: 1,
  SelectedAndTargeted: 2,
  PrioritiseSelected: 3,
  PrioritiseTargeted: 4,
} as const;

/** Number of tokens the system's `getApplyTargets()` would return. */
export function applyTargetCount(setting: number, selected: number, targeted: number): number {
  const useTargeted = setting === ApplyButtonsTo.TargetedOnly || setting >= ApplyButtonsTo.SelectedAndTargeted;
  const useSelected = setting === ApplyButtonsTo.SelectedOnly || setting >= ApplyButtonsTo.SelectedAndTargeted;
  let s = useSelected ? selected : 0;
  let t = useTargeted ? targeted : 0;
  if (setting === ApplyButtonsTo.PrioritiseSelected && s > 0) t = 0;
  if (setting === ApplyButtonsTo.PrioritiseTargeted && t > 0) s = 0;
  return s + t;
}

export interface AuditEntry {
  name: string;
  location: string;
  uuid: string;
  activationType: string;
  damageFormula: string | null;
  damageType: string | null;
  findings: Finding[];
}

const FIX_LABELS: Record<AbilityFix, string> = {
  clearDamage: "clear the damage formula",
  setUtility: "set activation to Utility",
  consumeCharge: "make its action spend 1 charge",
};

const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\s+/g, " ");

/** Markdown report suitable for an upstream issue. */
export function buildReport(entries: AuditEntry[], meta: { system: string; foundry: string }): string {
  const lines = [
    "## Ability data audit",
    "",
    `System: ${meta.system} · Foundry: ${meta.foundry} · Findings: ${entries.reduce((n, e) => n + e.findings.length, 0)}`,
    "",
  ];
  if (!entries.length) return [...lines, "No findings."].join("\n") + "\n";
  lines.push("| Action | Where | Activation | Damage | Problem | Suggested fix |", "| --- | --- | --- | --- | --- | --- |");
  for (const entry of entries) {
    const damage = entry.damageFormula ? `${entry.damageFormula}${entry.damageType ? ` (${entry.damageType})` : ""}` : "—";
    for (const finding of entry.findings) {
      lines.push(
        `| ${cell(entry.name)} | ${cell(entry.location)} | ${entry.activationType} | ${cell(damage)} | ${cell(finding.message)} | ${finding.fixes.map((f) => FIX_LABELS[f]).join(" or ")} |`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
