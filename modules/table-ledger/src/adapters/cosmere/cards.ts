// cosmere-rpg action cards and the actions behind them, as read by the strike
// abilities and Distracting Illusion.
import { MODULE_ID } from "../../constants";
import { htmlToText } from "../../abilities/audit-rules";
import { STRIKE_ABILITIES, type StrikeAbility } from "../../abilities/strike-abilities";
import { defenceFromText, type Defence } from "../../abilities/triggers";

export const SYSTEM_ID = "cosmere-rpg";
/** On a one-off Strike made for an ability: the ability's system id. */
export const ABILITY_FLAG = "strikeAbility";
/** On an attack card: per source (`illusion`, `ability`), the uuids of targets the attack can't graze. */
export const NO_GRAZE_FLAG = "noGraze";

/** The actor slice the strike abilities and Distracting Illusion read. */
export interface ActionActor {
  uuid: string;
  name: string;
  /** Owned items; each reader narrows them to the fields it uses. */
  items: Iterable<unknown>;
  system?: { skills?: Record<string, { rank?: number } | undefined> };
}

export interface CosmereAction {
  id?: string | null;
  uuid: string;
  name: string;
  type: string;
  img?: string;
  actor?: ActionActor | null;
  system?: {
    id?: string;
    description?: { value?: string | null };
    activation?: { type?: string | null; cost?: unknown };
    damage?: { formula?: string | null };
  };
  getFlag?(scope: string, key: string): unknown;
  use(options?: Record<string, unknown>): Promise<unknown>;
}

export interface CardTarget {
  uuid: string;
  name: string;
  def: Partial<Record<Defence, number>>;
}

export interface CardMessage {
  id: string;
  author?: { id: string };
  speaker?: unknown;
  whisper?: string[];
  blind?: boolean;
  rolls?: { total: number; dice?: { faces: number }[] }[];
  flags?: Record<string, { message?: { item?: unknown; targets?: CardTarget[] } } | undefined>;
  getFlag(scope: string, key: string): unknown;
  setFlag(scope: string, key: string, value: unknown): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
}

/** The strike ability an action is, or was made for. */
export function abilityOf(item: Pick<CosmereAction, "system" | "getFlag">): { id: string; ability: StrikeAbility } | null {
  const flagged = item.getFlag?.(MODULE_ID, ABILITY_FLAG);
  const id = typeof flagged === "string" ? flagged : item.system?.id;
  const ability = id ? STRIKE_ABILITIES[id] : undefined;
  return id && ability ? { id, ability } : null;
}

/** The use rolls an attack: the system sends a skill test with a damage formula through `rollAttack`. */
export function isAttackRoll(item: Pick<CosmereAction, "system">): boolean {
  return item.system?.activation?.type === "skill_test" && !!item.system?.damage?.formula;
}

/** The defence an attack is made against: the ability's, the one its text names, or Physical for a weapon or unarmed Strike. */
export function attackDefence(item: Pick<CosmereAction, "system" | "getFlag">): Defence | undefined {
  const found = abilityOf(item);
  if (found) return found.ability.defence;
  const named = defenceFromText(htmlToText(item.system?.description?.value));
  if (named) return named;
  const id = item.system?.id ?? "";
  if (item.getFlag?.(SYSTEM_ID, "isStrike") || id === "strike" || id.startsWith("strike-") || id === "unarmed-attack") return "phy";
  return undefined;
}

/** The system's card for the latest use of this item by this user. */
export function latestCard(item: Pick<CosmereAction, "id" | "uuid">): CardMessage | undefined {
  const messages: CardMessage[] = game.messages.contents;
  return messages.findLast((m) => {
    const ref = m.flags?.[SYSTEM_ID]?.message?.item;
    return m.author?.id === game.user.id && (ref === item.uuid || (!!item.id && ref === item.id));
  });
}

export function cardTargets(card: Pick<CardMessage, "flags">): CardTarget[] {
  return card.flags?.[SYSTEM_ID]?.message?.targets ?? [];
}

export function d20Of(card: Pick<CardMessage, "rolls">): number | null {
  return card.rolls?.find((r) => r.dice?.[0]?.faces === 20)?.total ?? null;
}

export function noGrazeTargets(card: Pick<CardMessage, "getFlag">): string[] {
  const flag = card.getFlag(MODULE_ID, NO_GRAZE_FLAG);
  if (!flag || typeof flag !== "object") return [];
  return Object.values(flag).flatMap((uuids) => (Array.isArray(uuids) ? uuids.filter((u): u is string => typeof u === "string") : []));
}
