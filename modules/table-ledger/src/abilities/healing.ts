// Pure healing maths for prompted heals. No Foundry globals.

/** "DC 15" in an action's text. */
export function parseDC(text: string): number | null {
  const match = /\bDC\s*(\d{1,2})\b/i.exec(text);
  return match ? Number(match[1]) : null;
}

/** Test outcome when both the d20 total and the DC are known. */
export function testSucceeded(total: number | null, dc: number | null): boolean | null {
  if (total === null || dc === null) return null;
  return total >= dc;
}

/** "d8" / "1d8" → "1d8"; anything else → null. */
export function normaliseDie(die: unknown): string | null {
  if (typeof die !== "string") return null;
  const match = /^\s*1?d(\d+)\s*$/i.exec(die);
  return match ? `1d${match[1]}` : null;
}

/**
 * Field Medicine: the target rolls their recovery die; on a success the
 * healer's Medicine ranks are added.
 */
export function fieldMedicineFormula(recoveryDie: string, medicineRanks: number, success: boolean): string {
  return success && medicineRanks > 0 ? `${recoveryDie} + ${medicineRanks}` : recoveryDie;
}

/**
 * Progression (Character Regrowth): 1d4 + Progression modifier at 1 rank, the
 * die growing a size per rank (d6 at 2, d8 at 3 …), capped at d12.
 */
export function regrowthFormula(progressionRanks: number, progressionModifier: number): string {
  const size = Math.min(12, 2 + 2 * Math.max(1, progressionRanks));
  return progressionModifier ? `1d${size} + ${progressionModifier}` : `1d${size}`;
}

/** A heal given to another character gains a flat bonus (Swift Healer: the healer's Medicine ranks). */
export function withHealBonus(formula: string, bonus: number): string {
  return bonus > 0 ? `${formula} + ${bonus}` : formula;
}
