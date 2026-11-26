// Abilities that say "make a weapon attack" (rules in abilities/strike-abilities).
// After the ability's own card (its cost already spent), ask which weapon, then
// make that weapon's Strike as a one-off action that carries the ability: its
// skill, raised stakes, extra dice and defence. After the Strike, a card applies
// the ability's effect to each target it hit, through the GM; a graze button
// covers "on a hit or graze". Conditions that last "until the end of <someone's>
// next turn" are removed when that turn ends.
import { MODULE_ID, localize } from "../../constants";
import { askGM, registerQuery, serialize, type QueryUser } from "../../queries";
import {
  attackOutcome,
  focusLoss,
  ridersFor,
  strikeFormula,
  turnEndExpires,
  weaponFits,
  type Rider,
  type StrikeAbility,
  type StrikeResult,
  type WeaponInfo,
} from "../../abilities/strike-abilities";
import { ABILITY_FLAG, NO_GRAZE_FLAG, SYSTEM_ID, abilityOf, cardTargets, d20Of, latestCard, noGrazeTargets, type ActionActor, type CardMessage, type CosmereAction } from "./cards";
import { weaponOptions } from "./improvised";

const SETTING = "abilityStrikes";
const RIDER_FLAG = "strikeRiders";
const EXPIRES_FLAG = "expires";

interface StrikeData {
  name?: string;
  img?: string;
  system: Record<string, unknown> & {
    skillTest?: Record<string, unknown>;
    damage?: Record<string, unknown> & { formula?: string | null };
  };
}

interface OwnedItem {
  id: string;
  name: string;
  type: string;
  system?: {
    id?: string;
    type?: string;
    equipped?: boolean;
    attack?: { type?: string };
    traits?: Record<string, { active?: boolean } | null | undefined>;
  };
  getWeaponStrikeData?(): StrikeData[];
  toObject?(): StrikeData;
}

interface AbilityAction extends CosmereAction {
  actor: ActionActor;
  constructor: new (data: Record<string, unknown>, options: { parent: ActionActor }) => CosmereAction;
}

interface WeaponChoice {
  key: string;
  name: string;
  group: "own" | "improvised";
  equipped: boolean;
  info: WeaponInfo;
  strikeData(): Promise<StrikeData | null>;
}

interface RiderTarget {
  uuid: string;
  name: string;
  outcome: "hit" | "miss" | null;
}

/** What the effect card stores in its message flag. */
interface RiderState {
  sourceMessageId: string;
  abilityId: string;
  name: string;
  attackerUuid: string;
  targets: RiderTarget[];
  applied: { uuid: string; result: StrikeResult; effects: string[] }[];
}

interface Expiry {
  combatId: string;
  combatantId: string;
  round: number;
  turn: number;
}

interface EffectDoc {
  id: string;
  getFlag(scope: string, key: string): unknown;
  setFlag(scope: string, key: string, value: unknown): Promise<unknown>;
}

interface TargetActor {
  uuid: string;
  name: string;
  effects: Iterable<EffectDoc>;
  system?: { resources?: { foc?: { value?: number } } };
  toggleStatusEffect(status: string, options: { active: boolean }): Promise<EffectDoc | boolean | undefined>;
  update(data: Record<string, unknown>): Promise<unknown>;
  deleteEmbeddedDocuments(type: "ActiveEffect", ids: string[]): Promise<unknown>;
  testUserPermission(user: unknown, level: "OWNER"): boolean;
}

interface CombatDoc {
  id: string;
  round: number;
  turn: number;
  started: boolean;
  combatants: Iterable<{ id: string; actor?: TargetActor | null }>;
}

interface RiderMessage {
  id: string;
  author?: { id: string };
  getFlag(scope: string, key: string): unknown;
  update(data: Record<string, unknown>): Promise<unknown>;
}

type Response = { ok: true } | { ok: false; error: string };

const enabled = (): boolean => game.settings.get(MODULE_ID, SETTING) === true;
const esc = (text: string): string => foundry.utils.escapeHTML(text);

/* -------------------------------------------- */
/*  The one-off Strike                          */
/* -------------------------------------------- */

function weaponInfo(item: OwnedItem): WeaponInfo {
  const id = item.system?.id ?? "";
  const traits = item.system?.traits ?? {};
  const ranged = item.system?.attack?.type === "ranged";
  return {
    // Characters carry Unarmed Strike as a weapon item (`unarmed`).
    kind: id === "unarmed" ? "unarmed" : id.startsWith("improvised-weapon") ? "improvised" : "weapon",
    melee: !ranged,
    ranged: ranged || !!traits.thrown?.active,
    light: item.system?.type === "light_wpn" || id === "improvised-weapon-light",
    discreet: !!traits.discreet?.active,
  };
}

const UNARMED: WeaponInfo = { kind: "unarmed", melee: true, ranged: false, light: false, discreet: false };

/** The system's Unarmed Attack: on the actor, else from the system's actions compendium. */
async function unarmedData(actor: ActionActor): Promise<StrikeData | null> {
  const owned = [...(actor.items as Iterable<OwnedItem>)].find((i) => i.type === "action" && i.system?.id === "unarmed-attack");
  if (owned?.toObject) return owned.toObject();
  const pack = game.packs.get(`${SYSTEM_ID}.actions`);
  const docs: OwnedItem[] = pack ? await pack.getDocuments() : [];
  return docs.find((d) => d.system?.id === "unarmed-attack")?.toObject?.() ?? null;
}

async function weaponChoices(actor: ActionActor, ability: StrikeAbility): Promise<WeaponChoice[]> {
  const choices: WeaponChoice[] = [];
  for (const item of actor.items as Iterable<OwnedItem>) {
    if (item.type !== "weapon" || !item.getWeaponStrikeData) continue;
    const info = weaponInfo(item);
    if (!weaponFits(ability, info)) continue;
    const strike = item.getWeaponStrikeData.bind(item);
    choices.push({ key: item.id, name: item.name, group: "own", equipped: !!item.system?.equipped, info, strikeData: async () => strike()[0] ?? null });
  }
  // The system's Unarmed Attack, for a character without an Unarmed Strike weapon.
  if (weaponFits(ability, UNARMED) && !choices.some((c) => c.info.kind === "unarmed")) {
    choices.push({ key: "unarmed", name: localize("StrikeAbilities.Unarmed"), group: "own", equipped: true, info: UNARMED, strikeData: () => unarmedData(actor) });
  }
  if (ability.weapons.includes("improvised")) {
    for (const option of await weaponOptions()) {
      const info: WeaponInfo = { kind: "improvised", melee: true, ranged: false, light: option.light, discreet: false };
      choices.push({ key: `improvised|${option.key}`, name: option.label, group: "improvised", equipped: false, info, strikeData: async () => option.doc.getWeaponStrikeData()[0] ?? null });
    }
  }
  return choices.sort((a, b) => Number(b.equipped) - Number(a.equipped));
}

async function chooseWeapon(item: AbilityAction, id: string, ability: StrikeAbility, choices: WeaponChoice[]): Promise<WeaponChoice | null> {
  const option = (c: WeaponChoice) =>
    `<option value="${esc(c.key)}">${esc(c.name)}${c.group === "own" && !c.equipped ? ` ${esc(localize("StrikeAbilities.Unequipped"))}` : ""}</option>`;
  const group = (name: WeaponChoice["group"], label: string) => {
    const list = choices.filter((c) => c.group === name);
    return list.length ? `<optgroup label="${esc(label)}">${list.map(option).join("")}</optgroup>` : "";
  };
  const note = ability.note ? `<p class="tl-abilities-hint">${esc(localize(`StrikeAbilities.Note.${id}`))}</p>` : "";
  const key: unknown = await foundry.applications.api.DialogV2.prompt({
    window: { title: item.name, icon: "fa-solid fa-khanda" },
    content: `<p>${esc(localize("StrikeAbilities.Choose", { name: item.name }))}</p>
      <div class="form-group"><select name="weapon" autofocus>${group("own", localize("StrikeAbilities.YourWeapons"))}${group("improvised", localize("StrikeAbilities.Improvised"))}</select></div>${note}`,
    ok: {
      label: localize("StrikeAbilities.Strike"),
      icon: "fa-solid fa-khanda",
      callback: (_event: unknown, button: { form: { elements: { weapon: { value: string } } } }) => button.form.elements.weapon.value,
    },
    rejectClose: false,
  });
  return choices.find((c) => c.key === key) ?? null;
}

async function strikeFor(item: AbilityAction, id: string, ability: StrikeAbility): Promise<void> {
  const choices = await weaponChoices(item.actor, ability);
  if (!choices.length) {
    ui.notifications.warn(localize("StrikeAbilities.NoWeapon", { name: item.name }));
    return;
  }
  const chosen = await chooseWeapon(item, id, ability, choices);
  const base = chosen ? await chosen.strikeData() : null;
  if (!chosen || !base) return;
  const system = foundry.utils.deepClone(base.system);
  const extra = ability.extraDamage ? (item.system?.damage?.formula ?? ability.extraDice) : null;
  system.damage = { ...system.damage, formula: strikeFormula(String(system.damage?.formula ?? "0"), extra) };
  system.skillTest = { ...system.skillTest, ...(ability.skill && { skill: ability.skill }), ...(ability.raiseStakes && { plotDie: true }) };
  system.description = { value: item.system?.description?.value ?? "" };
  if (item.system?.activation?.cost) system.activation = { ...(system.activation as object), cost: item.system.activation.cost };
  const strike = new item.constructor(
    {
      type: "action",
      name: localize("StrikeAbilities.StrikeName", { name: item.name, weapon: chosen.name }),
      img: item.img ?? base.img,
      system,
      // Not flagged as a system Strike: the target picker treats it as an attack ability and asks for a target.
      flags: { [MODULE_ID]: { [ABILITY_FLAG]: id } },
    },
    { parent: item.actor },
  );
  const options: Record<string, unknown> = {};
  if (ability.raiseStakes) options.plotDie = true;
  if (ability.discreetAdvantage && chosen.info.discreet) options.advantageMode = "advantage";
  await strike.use(options);
}

/* -------------------------------------------- */
/*  Effects on the targets                      */
/* -------------------------------------------- */

function riderText(id: string, rider: Rider, result: StrikeResult, attacker: ActionActor | null): string {
  switch (rider.kind) {
    case "condition": {
      const label: unknown = CONFIG.COSMERE?.statuses?.[rider.status]?.label;
      return game.i18n.localize(typeof label === "string" ? label : rider.status);
    }
    case "focus-loss": {
      const ranks = Number(attacker?.system?.skills?.[rider.skill]?.rank ?? 0);
      return localize("StrikeAbilities.FocusLoss", { amount: focusLoss(ranks, result) });
    }
    case "note":
      return localize(`StrikeAbilities.Rider.${id}`);
  }
}

/** The effects a hit or graze would apply, as text; notes are marked as left to the table. */
function effectsText(state: RiderState, ability: StrikeAbility, result: StrikeResult, cantGraze: boolean): string[] {
  const attacker: ActionActor | null = fromUuidSync(state.attackerUuid);
  return ridersFor(ability, result, cantGraze).map((rider) => {
    const text = riderText(state.abilityId, rider, result, attacker);
    return rider.kind === "note" ? localize("StrikeAbilities.ByHand", { text }) : text;
  });
}

function riderHtml(state: RiderState, ability: StrikeAbility, noGraze: readonly string[]): string {
  const lines = state.targets.map((target) => {
    const applied = state.applied.find((a) => a.uuid === target.uuid);
    const name = `<strong>${esc(target.name)}</strong>`;
    if (applied) {
      const label = localize(applied.result === "hit" ? "Triggers.Hit" : "StrikeAbilities.Graze");
      return `<li class="tl-abilities-rider-target applied">${name} ${esc(label)}: ${esc(applied.effects.join("; "))}</li>`;
    }
    if (target.outcome === "hit") {
      const effects = effectsText(state, ability, "hit", false);
      return `<li class="tl-abilities-rider-target">${name} ${esc(localize("Triggers.Hit"))}
        <button type="button" data-action="tl-rider-apply" data-result="hit" data-target="${esc(target.uuid)}">${esc(localize("StrikeAbilities.Apply", { effects: effects.join("; ") }))}</button></li>`;
    }
    const graze = target.outcome === "miss" ? effectsText(state, ability, "graze", noGraze.includes(target.uuid)) : [];
    const button = graze.length
      ? `<button type="button" data-action="tl-rider-apply" data-result="graze" data-target="${esc(target.uuid)}">${esc(localize("StrikeAbilities.ApplyGraze", { effects: graze.join("; ") }))}</button>`
      : "";
    const label = target.outcome === "miss" ? localize("Triggers.Miss") : localize("StrikeAbilities.NoRoll");
    return `<li class="tl-abilities-rider-target">${name} ${esc(label)} ${button}</li>`;
  });
  const none = state.targets.length
    ? ""
    : `<p>${esc(localize("StrikeAbilities.NoTarget", { effects: effectsText(state, ability, "hit", false).join("; ") }))}</p>`;
  return `<div class="tl-abilities-rider">
    <h3><i class="fa-solid fa-burst"></i> ${esc(state.name)}</h3>${none}
    <ul class="tl-abilities-rider-targets">${lines.join("")}</ul>
  </div>`;
}

async function applyRider(messageId: string, targetUuid: string, result: StrikeResult): Promise<void> {
  try {
    const response = await askGM<Response>("strike.rider", { messageId, targetUuid, result });
    if (!response.ok) ui.notifications.warn(localize(`StrikeAbilities.Error.${response.error}`));
  } catch (err) {
    ui.notifications.error(err instanceof Error ? err.message : String(err));
  }
}

/** After a Strike made for an ability (or an ability that rolls its own attack): post the effect card and apply hits. */
async function postRiders(item: CosmereAction, id: string, ability: StrikeAbility, name = item.name): Promise<void> {
  const card = latestCard(item);
  if (!card || !item.actor) return;
  if (ability.noGraze) await card.setFlag(MODULE_ID, `${NO_GRAZE_FLAG}.ability`, cardTargets(card).map((t) => t.uuid));
  if (!ability.riders.length) return;
  const d20 = d20Of(card);
  const state: RiderState = {
    sourceMessageId: card.id,
    abilityId: id,
    name,
    attackerUuid: item.actor.uuid,
    targets: cardTargets(card).map((t) => ({ uuid: t.uuid, name: t.name, outcome: attackOutcome(d20, t.def[ability.defence]) })),
    applied: [],
  };
  const message: RiderMessage | undefined = await ChatMessage.create({
    speaker: card.speaker,
    whisper: card.whisper,
    blind: card.blind,
    content: riderHtml(state, ability, noGrazeTargets(card)),
    flags: { [MODULE_ID]: { [RIDER_FLAG]: state } },
  });
  if (!message) return;
  // Only riders the module applies are worth a GM round trip; notes stay on the card.
  if (!ability.riders.some((r) => r.kind !== "note")) return;
  for (const target of state.targets) if (target.outcome === "hit") await applyRider(message.id, target.uuid, "hit");
}

interface EventsHolder {
  system?: { events?: Record<string, { event?: string; disabled?: boolean; handler?: { type?: string } } | undefined> };
}

/**
 * The item (or the talent it belongs to) carries a system item event that uses
 * a weapon when the action is used ("Roll Weapon Strike"): the system makes the
 * attack itself, with the first equipped weapon.
 */
function systemMakesStrike(item: CosmereAction & { parent?: unknown }): boolean {
  return [item, item.parent].some((doc) =>
    Object.values((doc as EventsHolder | null | undefined)?.system?.events ?? {}).some((e) => !!e && !e.disabled && e.handler?.type === "use-item"),
  );
}

/** An ability whose attack the system makes, waiting for that Strike, per attacker. */
const awaitingStrike = new Map<string, { id: string; ability: StrikeAbility; name: string; until: number }>();
const SYSTEM_STRIKE_MS = 10_000;

function isWeaponStrike(item: CosmereAction): boolean {
  const id = item.system?.id ?? "";
  return !!item.getFlag?.(SYSTEM_ID, "isStrike") || id.startsWith("strike-") || id === "unarmed-attack";
}

async function onUse(item: CosmereAction | undefined): Promise<void> {
  if (!enabled() || !item || item.type !== "action" || !item.actor) return;
  const found = abilityOf(item);
  if (!found) {
    // The Strike the system made for an ability gets that ability's effects.
    const waiting = awaitingStrike.get(item.actor.uuid);
    if (!waiting || !isWeaponStrike(item)) return;
    awaitingStrike.delete(item.actor.uuid);
    if (Date.now() <= waiting.until) await postRiders(item, waiting.id, waiting.ability, waiting.name);
    return;
  }
  // The ability itself (a Utility action): its card and cost are done, now the attack.
  if (!item.getFlag?.(MODULE_ID, ABILITY_FLAG) && item.system?.activation?.type !== "skill_test") {
    if (systemMakesStrike(item)) {
      awaitingStrike.set(item.actor.uuid, { id: found.id, ability: found.ability, name: item.name, until: Date.now() + SYSTEM_STRIKE_MS });
      return;
    }
    await strikeFor(item as AbilityAction, found.id, found.ability);
    return;
  }
  await postRiders(item, found.id, found.ability);
}

/** Attach the condition's end to the turn it lasts until, when a combat is running. */
async function setExpiry(effect: EffectDoc, whose: TargetActor | ActionActor): Promise<void> {
  const combat: CombatDoc | null = game.combat?.started ? game.combat : null;
  const combatant = combat && [...combat.combatants].find((c) => c.actor?.uuid === whose.uuid);
  if (!combat || !combatant) return;
  const expiry: Expiry = { combatId: combat.id, combatantId: combatant.id, round: combat.round, turn: combat.turn };
  await effect.setFlag(MODULE_ID, EXPIRES_FLAG, expiry);
}

/**
 * GM side of an effect. Only the attacker's own effect card, for a target its
 * attack recorded, once per target. A hit is re-checked from the attack card; a
 * graze needs a miss, and the ability and the target must allow grazing.
 */
async function rider(data: unknown, caller: QueryUser): Promise<Response> {
  const payload = data && typeof data === "object" ? data : {};
  const messageId = "messageId" in payload ? payload.messageId : undefined;
  const targetUuid = "targetUuid" in payload ? payload.targetUuid : undefined;
  const result = "result" in payload ? payload.result : undefined;
  if (typeof messageId !== "string" || typeof targetUuid !== "string" || (result !== "hit" && result !== "graze")) return { ok: false, error: "unknown" };
  const message: RiderMessage | undefined = game.messages.get(messageId);
  const state = message?.getFlag(MODULE_ID, RIDER_FLAG) as RiderState | undefined;
  const ability = state ? abilityOf({ system: { id: state.abilityId } })?.ability : undefined;
  const source: CardMessage | undefined = state ? game.messages.get(state.sourceMessageId) : undefined;
  if (!message || !state || !ability || !source) return { ok: false, error: "unknown" };
  if (message.author?.id !== caller.id && !caller.isGM) return { ok: false, error: "notOwner" };
  if (source.author?.id !== message.author?.id) return { ok: false, error: "notOwner" };
  if (state.applied.some((a) => a.uuid === targetUuid)) return { ok: false, error: "alreadyApplied" };
  const recorded = cardTargets(source).find((t) => t.uuid === targetUuid);
  if (!recorded) return { ok: false, error: "notTargeted" };
  const outcome = attackOutcome(d20Of(source), recorded.def[ability.defence]);
  if (outcome !== (result === "hit" ? "hit" : "miss")) return { ok: false, error: result === "hit" ? "notHit" : "notMissed" };
  const noGraze = noGrazeTargets(source);
  const riders = ridersFor(ability, result, noGraze.includes(targetUuid));
  if (!riders.length) return { ok: false, error: "cantGraze" };
  const attacker: ActionActor | null = await fromUuid(state.attackerUuid);
  const target: TargetActor | null = await fromUuid(targetUuid);
  if (!attacker || !target) return { ok: false, error: "unknown" };

  const effects: string[] = [];
  for (const r of riders) {
    const text = riderText(state.abilityId, r, result, attacker);
    if (r.kind === "condition") {
      const effect = await target.toggleStatusEffect(r.status, { active: true });
      if (effect && typeof effect === "object") await setExpiry(effect, r.until === "attacker-turn" ? attacker : target);
      effects.push(text);
    } else if (r.kind === "focus-loss") {
      const ranks = Number(attacker.system?.skills?.[r.skill]?.rank ?? 0);
      const focus = Number(target.system?.resources?.foc?.value ?? 0);
      await target.update({ "system.resources.foc.value": Math.max(0, focus - focusLoss(ranks, result)) });
      effects.push(text);
    } else {
      effects.push(localize("StrikeAbilities.ByHand", { text }));
    }
  }
  const next: RiderState = { ...state, applied: [...state.applied, { uuid: targetUuid, result, effects }] };
  await message.update({ content: riderHtml(next, ability, noGraze), [`flags.${MODULE_ID}.${RIDER_FLAG}`]: next });
  return { ok: true };
}

/* -------------------------------------------- */
/*  Expiry                                      */
/* -------------------------------------------- */

function expiringEffects(combat: CombatDoc, expired: (expiry: Expiry) => boolean): Map<TargetActor, string[]> {
  const out = new Map<TargetActor, string[]>();
  const seen = new Set<string>();
  for (const { actor } of combat.combatants) {
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    const ids = [...actor.effects]
      .filter((e) => {
        const expiry = e.getFlag(MODULE_ID, EXPIRES_FLAG) as Expiry | undefined;
        return !!expiry && expiry.combatId === combat.id && expired(expiry);
      })
      .map((e) => e.id);
    if (ids.length) out.set(actor, ids);
  }
  return out;
}

async function removeExpired(combat: CombatDoc, expired: (expiry: Expiry) => boolean): Promise<void> {
  if (!game.user.isActiveGM) return;
  for (const [actor, ids] of expiringEffects(combat, expired)) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

function onRenderChatMessage(message: RiderMessage, html: HTMLElement): void {
  if (!message.getFlag(MODULE_ID, RIDER_FLAG)) return;
  const buttons = html.querySelectorAll<HTMLButtonElement>("[data-action='tl-rider-apply']");
  const mine = game.user.isGM || message.author?.id === game.user.id;
  for (const button of buttons) {
    if (!mine) {
      button.remove();
      continue;
    }
    button.addEventListener("click", () => {
      const result = button.dataset.result;
      if (result !== "hit" && result !== "graze") return;
      button.disabled = true;
      void applyRider(message.id, button.dataset.target ?? "", result).finally(() => (button.disabled = false));
    });
  }
}

/** Register the setting, the GM query and the hooks. Call from `init`. */
export function registerStrikeAbilities(): void {
  game.settings.register(MODULE_ID, SETTING, {
    name: "TABLE_LEDGER.StrikeAbilities.Settings.Name",
    hint: "TABLE_LEDGER.StrikeAbilities.Settings.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  registerQuery("strike.rider", serialize(rider), { access: "player" });
  Hooks.on(`${SYSTEM_ID}.useItem`, (item: CosmereAction | undefined) =>
    void onUse(item).catch((err: unknown) => ui.notifications.error(err instanceof Error ? err.message : String(err))),
  );
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("combatTurnChange", (combat: CombatDoc, prior: { round: number; turn: number; combatantId?: string | null }) =>
    void removeExpired(combat, (expiry) => turnEndExpires(expiry, prior, expiry.combatantId)),
  );
  Hooks.on("deleteCombat", (combat: CombatDoc) => void removeExpired(combat, () => true));
}

/** Whether the module makes the attack for this action, so the card needs no "use your Strike" hint. */
export function makesStrike(item: Pick<CosmereAction, "system" | "getFlag">): boolean {
  return enabled() && !!abilityOf(item);
}
