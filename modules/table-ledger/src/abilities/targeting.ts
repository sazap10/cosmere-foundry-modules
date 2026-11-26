// Pure targeting rules: which actions need a target, and how to order the
// target picker. No Foundry globals.
import type { NormalisedAction } from "../adapters/types";
import { isHealing, needsTarget } from "./audit-rules";

export type TargetSide = "enemy" | "ally";

/**
 * Which kind of target an action is used on, or null when it isn't targeted.
 * `allyIds` lists system action ids that target a willing character but carry
 * no heal formula (e.g. Progression's Regrowth, Injury Regrowth).
 */
export function targetSide(action: NormalisedAction & { id?: string }, allyIds: readonly string[]): TargetSide | null {
  if (needsTarget(action)) return "enemy";
  if (isHealing(action) || (action.id !== undefined && allyIds.includes(action.id))) return "ally";
  return null;
}

/** Ask for a target before the use (and before any focus/Investiture is spent). */
export function shouldPickTarget(args: {
  enabled: boolean;
  reentering: boolean;
  side: TargetSide | null;
  targetCount: number;
}): boolean {
  return args.enabled && !args.reentering && args.side !== null && args.targetCount === 0;
}

/**
 * The token the picker targeted last time is still the only target at a fresh
 * use: it was chosen for that earlier use, not this one, so ask again rather
 * than reuse it silently. A target the user set themselves never matches.
 */
export function pickedTargetLingers(pickedTokenId: string | null, targetIds: readonly string[]): boolean {
  return pickedTokenId !== null && targetIds.length === 1 && targetIds[0] === pickedTokenId;
}

export interface TargetCandidate {
  actorUuid: string;
  name: string;
  img?: string;
  /** Canvas token id when the actor has a token on the viewed scene. */
  tokenId?: string;
  /** CONST.TOKEN_DISPOSITIONS: -1 hostile, 0 neutral, 1 friendly; party members count as friendly. */
  disposition: number;
  /** The user's own character (Field Medicine can treat yourself). */
  isSelf: boolean;
}

/**
 * Likely targets first: allies (party, friendly tokens) for heals, hostiles
 * for attacks; the user's own character last among allies. Ties by name.
 */
export function orderCandidates(candidates: TargetCandidate[], side: TargetSide): TargetCandidate[] {
  const rank = (c: TargetCandidate) => {
    const friendly = c.disposition > 0;
    const hostile = c.disposition < 0;
    if (side === "ally") return friendly ? (c.isSelf ? 1 : 0) : hostile ? 3 : 2;
    return hostile ? 0 : friendly ? 2 : 1;
  };
  return [...candidates].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
