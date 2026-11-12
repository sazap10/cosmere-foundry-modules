/** A goal on a character, normalised across systems. */
export interface GoalView {
  itemUuid: string;
  name: string;
  level: number;
  max: number;
  description?: string;
}

export interface CharacterGoals {
  actorUuid: string;
  actorName: string;
  img?: string;
  purpose?: string;
  obstacle?: string;
  goals: GoalView[];
}

export interface GoalsAdapter {
  /** Player-owned characters with their goals. */
  listCharacters(): CharacterGoals[];
  /** Goals for one actor (used by the player widget). */
  forActor(actor: unknown): CharacterGoals | null;
  setLevel(itemUuid: string, level: number): Promise<void>;
  /** Register hooks that should trigger a goals re-render. Returns nothing; callback may fire often. */
  onChange(callback: () => void): void;
  /** Register a callback for goal completion (fired on every client; caller gates on isActiveGM). */
  onComplete(callback: (item: unknown) => void): void;
}

export type AbilityFix = "clearDamage" | "setUtility" | "consumeCharge";

/** A counted item resource (charges, ammo) and whether any of the item's actions spends it. */
export interface ChargeInfo {
  key: string;
  /** Some embedded action already has a consumption entry for this resource. */
  consumed: boolean;
  /** Number of embedded actions; the automatic fix needs exactly one. */
  actionCount: number;
}

/** One usable action, normalised for the audit (plain-text description). */
export interface NormalisedAction {
  name: string;
  description: string;
  activationType: string;
  damageFormula: string | null;
  damageType: string | null;
  hasDefenceTarget: boolean;
  /** Set on items (not actions) that carry charges or ammo. */
  charges?: ChargeInfo;
}

export interface AbilityRecord extends NormalisedAction {
  /** Opaque handle to the document, passed back to `applyFix`. */
  ref: unknown;
  uuid: string;
  /** Where the action lives, e.g. "Kaladin › Field Medicine". */
  location: string;
}

export interface AbilityAdapter {
  /** init: settings + system hooks (guards, talent hint). */
  register(): void;
  /** ready: one-time per-client onboarding. */
  ready(): void;
  /** Every auditable action in the world (world items + actor items + embedded actions). */
  scan(): AbilityRecord[];
  applyFix(ref: unknown, fix: AbilityFix): Promise<void>;
}

/** Per-system capabilities. A missing capability disables that feature entirely. */
export interface SystemAdapter {
  systemId: string;
  goals?: GoalsAdapter;
  abilities?: AbilityAdapter;
}
