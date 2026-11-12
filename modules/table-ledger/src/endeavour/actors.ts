import { partyActors } from "../party";

// Actor and skill lookups. System-neutral: skills come from `actor.system.skills`
// keys when the system has them (cosmere-rpg, dnd5e), labels from
// `CONFIG.COSMERE.skills[key].label` / `CONFIG.DND5E.skills[key].label` when present.

/** The slice of an Actor document the endeavour tracker reads. */
export interface PcActor {
  id: string;
  uuid: string;
  name: string;
  img?: string;
  type: string;
  hasPlayerOwner: boolean;
  isOwner: boolean;
  system?: { skills?: Record<string, { unlocked?: boolean } | undefined> };
  testUserPermission(user: unknown, level: "OWNER"): boolean;
}

export interface SkillOption {
  key: string;
  label: string;
}

/** PCs: characters assigned to players (see `partyActors`). */
export function playerCharacters(): PcActor[] {
  return partyActors<PcActor>(
    (a): a is PcActor => typeof a === "object" && a !== null && (a as PcActor).type === "character",
  );
}

export function skillLabel(key: string | undefined): string {
  if (!key) return "";
  const label: unknown = (CONFIG.COSMERE?.skills ?? CONFIG.DND5E?.skills)?.[key]?.label;
  return typeof label === "string" ? game.i18n.localize(label) : key;
}

/**
 * Skills the actors can use, sorted by label. Cosmere surge skills carry
 * `unlocked: false` until the actor has the power, so those are skipped.
 */
export function skillOptions(actors: PcActor[]): SkillOption[] {
  const keys = new Set<string>();
  for (const actor of actors) {
    for (const [key, skill] of Object.entries(actor.system?.skills ?? {})) if (skill?.unlocked !== false) keys.add(key);
  }
  return [...keys].map((key) => ({ key, label: skillLabel(key) })).sort((a, b) => a.label.localeCompare(b.label));
}
