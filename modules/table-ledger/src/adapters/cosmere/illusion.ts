// Distracting Illusion (Stormlight Handbook, Illumination): "Spend 1 Investiture
// to Lightweave an illusory duplicate, either of yourself or an ally you can
// sense within your spren bond range. ... Attacks against that character gain a
// disadvantage and can't graze. The illusion ends after an attack misses that
// character or at the end of the scene."
//
// Using it marks the chosen character with an effect (shown on their tokens).
// An attack against a marked character starts with a disadvantage and its card
// says it can't graze; a miss removes the mark through the GM, and so does the
// end of the combat (the module's stand-in for the end of the scene).
import { MODULE_ID, localize } from "../../constants";
import { askGM, registerQuery, serialize, type QueryUser } from "../../queries";
import { addDisadvantage, attackOutcome, type AdvantageMode } from "../../abilities/strike-abilities";
import {
  NO_GRAZE_FLAG,
  abilityOf,
  attackDefence,
  cardDefence,
  cardTargets,
  d20Of,
  isAttackRoll,
  latestCard,
  noGrazeTargets,
  type CardMessage,
  type CosmereAction,
} from "./cards";

const SETTING = "distractingIllusion";
/** System ids of the action; the Handbook's embedded action is misspelled. */
export const ILLUSION_IDS: readonly string[] = ["distracting-illusion", "distracint-illusion"];
const STATUS = "table-ledger-distracting-illusion";
const EFFECT_FLAG = "illusion";
const ICON = "icons/svg/aura.svg";

interface EffectDoc {
  id: string;
  getFlag(scope: string, key: string): unknown;
}

interface MarkedActor {
  uuid: string;
  name: string;
  type?: string;
  effects: Iterable<EffectDoc>;
  /** The token document of an unlinked (synthetic) actor. */
  token?: { disposition?: number } | null;
  prototypeToken?: { disposition?: number };
  testUserPermission(user: unknown, level: "OWNER"): boolean;
  createEmbeddedDocuments(type: "ActiveEffect", data: Record<string, unknown>[], options?: { keepId?: boolean }): Promise<unknown>;
  deleteEmbeddedDocuments(type: "ActiveEffect", ids: string[]): Promise<unknown>;
}

/** CONST.TOKEN_DISPOSITIONS.FRIENDLY */
const FRIENDLY = 1;

/** "Yourself or an ally": the caster, a player character, or a friendly token's actor. */
function isAllyOf(target: MarkedActor, caster: MarkedActor): boolean {
  if (target.uuid === caster.uuid || target.type === "character") return true;
  return (target.token?.disposition ?? target.prototypeToken?.disposition) === FRIENDLY;
}

export interface IllusionDeps {
  /** The ally the target picker chose for this use, if any. */
  pickedTarget(item: CosmereAction): string | undefined;
}

type Response = { ok: true } | { ok: false; error: string };

const enabled = (): boolean => game.settings.get(MODULE_ID, SETTING) === true;
const esc = (text: string): string => foundry.utils.escapeHTML(text);

function illusionEffects(actor: MarkedActor | null | undefined): EffectDoc[] {
  return actor?.effects ? [...actor.effects].filter((e) => !!e.getFlag(MODULE_ID, EFFECT_FLAG)) : [];
}

export function hasIllusion(actor: unknown): boolean {
  return illusionEffects(actor as MarkedActor | null).length > 0;
}

/**
 * The use options with the illusion's disadvantage added, when this is an
 * attack and a current target is marked; null when nothing changes.
 */
export function attackAdjustment(item: Pick<CosmereAction, "system">, options: Record<string, unknown>): Record<string, unknown> | null {
  if (!enabled() || !isAttackRoll(item)) return null;
  const targets: Iterable<{ actor?: MarkedActor | null }> = game.user.targets;
  const marked = [...targets].map((t) => t.actor).filter((a): a is MarkedActor => hasIllusion(a));
  if (!marked.length) return null;
  const current = options.advantageMode as AdvantageMode | undefined;
  const next = addDisadvantage(current);
  if (next === current) return null;
  ui.notifications.info(localize("Illusion.Disadvantage", { names: marked.map((a) => a.name).join(", ") }));
  return { ...options, advantageMode: next };
}

/** No graze on this attack: the ability can't graze, or every recorded target had the illusion. */
export function grazeBlocked(item: Pick<CosmereAction, "system" | "getFlag">, targetUuids: string[]): boolean {
  if (abilityOf(item)?.ability.noGraze) return true;
  return enabled() && targetUuids.length > 0 && targetUuids.every((uuid) => hasIllusion(fromUuidSync(uuid)));
}

/** The chat hint for an attack card with targets it can't graze. */
export function noGrazeHint(card: Pick<CardMessage, "getFlag" | "flags">): string | null {
  const uuids = noGrazeTargets(card);
  if (!uuids.length) return null;
  const names = cardTargets(card)
    .filter((t) => uuids.includes(t.uuid))
    .map((t) => t.name);
  return localize("Illusion.CantGraze", { names: names.join(", ") });
}

async function askOutcome(attack: string, target: string): Promise<"hit" | "miss" | null> {
  const choice: unknown = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("Illusion.Name") },
    content: `<p>${esc(localize("Illusion.AskOutcome", { attack, target }))}</p>`,
    buttons: [
      { action: "hit", label: localize("Triggers.Hit") },
      { action: "miss", label: localize("Triggers.Miss"), default: true },
    ],
    rejectClose: false,
  });
  return choice === "hit" || choice === "miss" ? choice : null;
}

async function callGM(name: string, data: Record<string, unknown>): Promise<void> {
  try {
    const response = await askGM<Response>(name, data);
    if (!response.ok) ui.notifications.warn(localize(`Illusion.Error.${response.error}`));
  } catch (err) {
    ui.notifications.error(err instanceof Error ? err.message : String(err));
  }
}

async function onUse(item: CosmereAction | undefined, deps: IllusionDeps): Promise<void> {
  if (!enabled() || !item || item.type !== "action" || !item.actor) return;
  if (ILLUSION_IDS.includes(item.system?.id ?? "")) {
    // "Yourself or an ally": with no ally chosen, the illusion is of the caster. A leftover target
    // that isn't an ally (the picker is skipped while anything is targeted) doesn't count.
    const first: { actor?: MarkedActor | null } | undefined = game.user.targets.first?.();
    const caster = item.actor as unknown as MarkedActor;
    const fallback = first?.actor && isAllyOf(first.actor, caster) ? first.actor.uuid : caster.uuid;
    const targetUuid = deps.pickedTarget(item) ?? fallback;
    await callGM("illusion.apply", { casterUuid: caster.uuid, targetUuid });
    return;
  }
  if (!isAttackRoll(item)) return;
  const card = latestCard(item);
  if (!card) return;
  const marked = cardTargets(card).filter((t) => hasIllusion(fromUuidSync(t.uuid)));
  if (!marked.length) return;
  await card.setFlag(MODULE_ID, `${NO_GRAZE_FLAG}.illusion`, marked.map((t) => t.uuid));
  const defence = attackDefence(item);
  const d20 = d20Of(card);
  for (const target of marked) {
    const outcome = (defence ? attackOutcome(d20, target.def[defence]) : null) ?? (await askOutcome(item.name, target.name));
    if (outcome !== "miss") continue;
    await callGM("illusion.clear", { messageId: card.id, targetUuid: target.uuid });
  }
}

/** GM side of casting: the caller must own the caster, and the target must be the caster or an ally. One illusion per character; a new one replaces the old. */
async function apply(data: unknown, caller: QueryUser): Promise<Response> {
  const payload = data && typeof data === "object" ? data : {};
  const casterUuid = "casterUuid" in payload ? payload.casterUuid : undefined;
  const targetUuid = "targetUuid" in payload ? payload.targetUuid : undefined;
  if (typeof casterUuid !== "string" || typeof targetUuid !== "string") return { ok: false, error: "unknown" };
  const caster: MarkedActor | null = await fromUuid(casterUuid);
  const target: MarkedActor | null = await fromUuid(targetUuid);
  if (!caster || !target) return { ok: false, error: "unknown" };
  if (!caster.testUserPermission(caller, "OWNER")) return { ok: false, error: "notOwner" };
  if (!isAllyOf(target, caster)) return { ok: false, error: "notAlly" };
  const old = illusionEffects(target).map((e) => e.id);
  if (old.length) await target.deleteEmbeddedDocuments("ActiveEffect", old);
  // An explicit id: cosmere-rpg's effect `_preCreate` reads `this.id` for any effect with exactly one status, and crashes while it's still null.
  await target.createEmbeddedDocuments(
    "ActiveEffect",
    [
      {
        _id: foundry.utils.randomID(),
        name: localize("Illusion.Name"),
        img: ICON,
        origin: casterUuid,
        statuses: [STATUS],
        description: localize("Illusion.EffectDescription"),
        flags: { [MODULE_ID]: { [EFFECT_FLAG]: { caster: casterUuid } } },
      },
    ],
    { keepId: true },
  );
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<p>${esc(localize("Illusion.Applied", { caster: caster.name, target: target.name }))}</p>`,
  });
  return { ok: true };
}

/**
 * GM side of a miss. Only the attacker's own card counts, and only for a target
 * it recorded. The defence comes from the card, never the request: with it the
 * miss is re-checked; without it a player's miss needs the GM to confirm.
 */
async function clear(data: unknown, caller: QueryUser): Promise<Response> {
  const payload = data && typeof data === "object" ? data : {};
  const messageId = "messageId" in payload ? payload.messageId : undefined;
  const targetUuid = "targetUuid" in payload ? payload.targetUuid : undefined;
  if (typeof messageId !== "string" || typeof targetUuid !== "string") return { ok: false, error: "unknown" };
  const message: CardMessage | undefined = game.messages.get(messageId);
  if (!message) return { ok: false, error: "unknown" };
  if (message.author?.id !== caller.id && !caller.isGM) return { ok: false, error: "notOwner" };
  const recorded = cardTargets(message).find((t) => t.uuid === targetUuid);
  if (!recorded) return { ok: false, error: "notTargeted" };
  const defence = cardDefence(message);
  if (defence) {
    if (attackOutcome(d20Of(message), recorded.def[defence]) !== "miss") return { ok: false, error: "notMissed" };
  } else if (!caller.isGM) {
    // Asked without holding the reply: the player's request would time out while the GM decides.
    void confirmMiss(caller.name, recorded.name, targetUuid);
    return { ok: true };
  }
  await endIllusion(targetUuid);
  return { ok: true };
}

async function confirmMiss(attacker: string, targetName: string, targetUuid: string): Promise<void> {
  const confirmed: unknown = await foundry.applications.api.DialogV2.confirm({
    window: { title: localize("Illusion.Name") },
    content: `<p>${esc(localize("Illusion.ConfirmMiss", { attacker, target: targetName }))}</p>`,
    rejectClose: false,
  });
  if (confirmed === true) await endIllusion(targetUuid);
}

async function endIllusion(targetUuid: string): Promise<void> {
  const target: MarkedActor | null = await fromUuid(targetUuid);
  const ids = illusionEffects(target).map((e) => e.id);
  if (!target || !ids.length) return;
  await target.deleteEmbeddedDocuments("ActiveEffect", ids);
  await ChatMessage.create({ content: `<p>${esc(localize("Illusion.Ended", { target: target.name }))}</p>` });
}

/** The end of the combat stands in for the end of the scene. Off-scene allies aren't combatants, so world actors are swept too. */
async function onDeleteCombat(combat: { combatants: Iterable<{ actor?: MarkedActor | null }> }): Promise<void> {
  if (!game.user.isActiveGM || !enabled()) return;
  const actors: (MarkedActor | null | undefined)[] = [...[...combat.combatants].map((c) => c.actor), ...(game.actors as Iterable<MarkedActor>)];
  const seen = new Set<string>();
  for (const actor of actors) {
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    const ids = illusionEffects(actor).map((e) => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

/** Register the setting, the GM queries and the hooks. Call from `init`, before any hook that clears the picked target. */
export function registerIllusion(deps: IllusionDeps): void {
  game.settings.register(MODULE_ID, SETTING, {
    name: "TABLE_LEDGER.Illusion.Settings.Name",
    hint: "TABLE_LEDGER.Illusion.Settings.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  registerQuery("illusion.apply", serialize(apply), { access: "player" });
  registerQuery("illusion.clear", serialize(clear), { access: "player" });
  Hooks.on("cosmere-rpg.useItem", (item: CosmereAction | undefined) => void onUse(item, deps));
  Hooks.on("deleteCombat", (combat: Parameters<typeof onDeleteCombat>[0]) => void onDeleteCombat(combat));
}
