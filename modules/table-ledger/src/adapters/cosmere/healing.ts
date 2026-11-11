// Cosmere RPG heals whose amount the *target* rolls, keyed by the action's
// system id (cosmere-rpg 3.1.0 data, checked against the Stormlight Handbook
// text on the items):
// - Field Medicine (`field-medicine`): DC 15 Medicine test; the target recovers
//   their recovery die + the healer's Medicine ranks on a success, the
//   recovery die alone on a failure.
// - Progression (`prg`), Character Regrowth: the target recovers 1d4 +
//   Progression modifier at the start of each of their turns while infused
//   (die grows with ranks), so the request can be rolled again each turn.
import { MODULE_ID, localize } from "../../constants";
import type { HealRequest } from "../../abilities/heal-prompt";
import { fieldMedicineFormula, normaliseDie, parseDC, regrowthFormula, testSucceeded, withHealBonus } from "../../abilities/healing";
import { matchTriggers, rulesFor, type UseDescription } from "../../abilities/triggers";
import { BUILT_IN_RULES } from "./trigger-rules";

/** Ally-targeted actions without a heal formula; the picker still asks for a target. */
export const ALLY_ACTION_IDS = ["field-medicine", "prg", "injury-regrowth"] as const;

interface Skill {
  rank?: number;
  mod?: { value?: number; derived?: number };
}

export interface HealerActor {
  uuid?: string;
  name: string;
  system?: { skills?: Record<string, Skill | undefined> };
  items?: Iterable<{ system?: { id?: string }; getFlag?(scope: string, key: string): unknown }>;
}

export interface HealTarget {
  uuid: string;
  name: string;
  system?: { recovery?: { die?: { value?: string; derived?: string } } };
}

export interface HealAction {
  name: string;
  system?: { id?: string; description?: { value?: string | null } };
}

/** The d20 total on the message the use produced, if any. */
export type TestTotal = number | null;

/** The heal request for this use, or null when the action isn't a target-rolled heal. */
export function healRequestFor(
  action: HealAction,
  healer: HealerActor,
  target: HealTarget,
  testTotal: TestTotal,
): Omit<HealRequest, "rolls"> | null {
  const base = { targetUuid: target.uuid, targetName: target.name, healerName: healer.name, ability: action.name };
  const request = baseRequest(action, healer, target, testTotal, base);
  if (!request) return null;
  // Mandatory heal riders (Swift Healer) add the healer's Medicine ranks to a heal given to someone else.
  const bonus = healBonus(healer, target);
  if (!bonus) return request;
  return {
    ...request,
    formula: withHealBonus(request.formula, bonus),
    note: [request.note, localize("Abilities.Heal.SwiftHealerNote", { ranks: bonus })].filter(Boolean).join(" "),
  };
}

function healBonus(healer: HealerActor, target: HealTarget): number {
  if (healer.uuid && healer.uuid === target.uuid) return 0;
  const rules = (healer.items ? [...healer.items] : []).flatMap(
    (item) => rulesFor({ systemId: item.system?.id, tag: item.getFlag?.(MODULE_ID, "trigger") }, BUILT_IN_RULES).rules,
  );
  const heal: UseDescription = { weapon: false, melee: false, attack: false, healsOther: true, d20: null, targets: [] };
  const hasRider = matchTriggers(heal, rules).riders.some((rule) => rule.effect === "heal-bonus");
  return hasRider ? Number(healer.system?.skills?.med?.rank ?? 0) : 0;
}

function baseRequest(
  action: HealAction,
  healer: HealerActor,
  target: HealTarget,
  testTotal: TestTotal,
  base: Pick<HealRequest, "targetUuid" | "targetName" | "healerName" | "ability">,
): Omit<HealRequest, "rolls"> | null {
  switch (action.system?.id) {
    case "field-medicine": {
      const die = normaliseDie(target.system?.recovery?.die?.value ?? target.system?.recovery?.die?.derived);
      if (!die) return null;
      const dc = parseDC((action.system?.description?.value ?? "").replace(/<[^>]+>/g, " ")) ?? 15;
      const success = testSucceeded(testTotal, dc);
      const ranks = Number(healer.system?.skills?.med?.rank ?? 0);
      const note =
        success === null
          ? localize("Abilities.Heal.UnknownOutcome", { dc, ranks })
          : localize(success ? "Abilities.Heal.TestSuccess" : "Abilities.Heal.TestFailure", { total: testTotal, dc });
      // Outcome unknown (e.g. no d20 on the card): roll the die alone; the note says what to add.
      return { ...base, formula: fieldMedicineFormula(die, ranks, success === true), note, repeatable: false };
    }
    case "prg": {
      const skill = healer.system?.skills?.prg;
      return {
        ...base,
        formula: regrowthFormula(Number(skill?.rank ?? 1), Number(skill?.mod?.value ?? skill?.mod?.derived ?? 0)),
        note: localize("Abilities.Heal.RegrowthNote"),
        repeatable: true,
      };
    }
    default:
      return null;
  }
}
