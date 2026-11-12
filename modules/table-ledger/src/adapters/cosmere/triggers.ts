import { MODULE_ID, localize } from "../../constants";
import { askGM, registerQuery, serialize, type QueryUser } from "../../queries";
import { pickTarget } from "../../abilities/target-picker";
import { needsTarget } from "../../abilities/audit-rules";
import { openTriggerPopup, postTriggerCard, registerTriggerOffers, type TriggerHost } from "../../abilities/trigger-offer";
import {
  defenceFromText,
  matchTriggers,
  matchesKind,
  type Defence,
  type OfferView,
  type TriggerCardState,
  type TriggerRule,
  type UseDescription,
  type UseTarget,
} from "../../abilities/triggers";
import { rulesOfItem } from "./trigger-rules";

const SYSTEM_ID = "cosmere-rpg";
const ENABLED_SETTING = "abilityTriggers";
const LIMITS_FLAG = "limits";
const SOURCE_FLAG = "triggered";

interface TriggerItem {
  id?: string;
  uuid: string;
  name: string;
  type: string;
  actor?: TriggerActor | null;
  parent?: TriggerItem | TriggerActor | null;
  items?: Iterable<TriggerItem>;
  defaultAction?: TriggerItem | null;
  system?: {
    id?: string;
    description?: { value?: string | null };
    activation?: { type?: string | null };
    damage?: { formula?: string | null; type?: string | null; grazeOverrideFormula?: string | null };
    attack?: { type?: string };
  };
  getFlag<T = unknown>(scope: string, key: string): T | undefined;
  setFlag(scope: string, key: string, value: unknown): Promise<unknown>;
  use(options: Record<string, unknown>): Promise<unknown>;
}

interface TriggerActor {
  uuid: string;
  name: string;
  items: Iterable<TriggerItem>;
  system?: { resources?: { foc?: { value?: number } }; defenses?: Record<string, { value?: number } | undefined> };
  update(data: Record<string, unknown>): Promise<unknown>;
  getRollData(): Record<string, unknown>;
  applyHealing(amount: number): Promise<unknown>;
  applyDamage(instances: { amount: number; type: string }[]): Promise<unknown>;
  testUserPermission(user: unknown, level: "OWNER"): boolean;
  getDependentTokens(): { parent?: unknown }[];
}

interface CardMessage {
  id: string;
  author?: { id: string };
  whisper?: string[];
  blind?: boolean;
  speaker?: unknown;
  rolls?: { total: number; dice?: { faces: number }[] }[];
  flags?: Record<string, { message?: { item?: unknown; targets?: { uuid: string; name: string; def?: Partial<Record<Defence, number>> }[] } } | undefined>;
  getFlag(scope: string, key: string): unknown;
  setFlag(scope: string, key: string, value: unknown): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
}

export interface TriggerDeps {
  isStrike(item: TriggerItem): boolean;
  normalise(item: TriggerItem): Parameters<typeof needsTarget>[0];
  pickedTarget(item: TriggerItem): string | undefined;
  /** Resolves once a target-picker veto and re-run for this item has finished. */
  pickFlight(item: TriggerItem): Promise<void> | undefined;
}

const enabled = (): boolean => game.settings.get(MODULE_ID, ENABLED_SETTING) === true;

/** Follow-ups started from an offer: their use must not raise offers, and its hook says it happened. */
const followUps = new Map<TriggerItem, boolean>();

const defenceOrDefault = (value: unknown): number => (typeof value === "number" ? value : 10);

function targetsOf(card: CardMessage): UseTarget[] {
  return (card.flags?.[SYSTEM_ID]?.message?.targets ?? []).map((t) => ({
    uuid: t.uuid,
    def: { phy: defenceOrDefault(t.def?.phy), cog: defenceOrDefault(t.def?.cog), spi: defenceOrDefault(t.def?.spi) },
  }));
}

function defencesOf(actor: TriggerActor | null | undefined): Record<Defence, number> | undefined {
  const d = actor?.system?.defenses;
  if (!d) return undefined;
  return { phy: defenceOrDefault(d.phy?.value), cog: defenceOrDefault(d.cog?.value), spi: defenceOrDefault(d.spi?.value) };
}

/** The system's card for this use: the newest by this user for this item that hasn't raised offers yet. */
function findCard(item: TriggerItem): CardMessage | undefined {
  const messages: CardMessage[] = game.messages.contents;
  return messages.findLast(
    (m) => m.author?.id === game.user.id && m.flags?.[SYSTEM_ID]?.message?.item === item.uuid && !m.getFlag(MODULE_ID, SOURCE_FLAG),
  );
}

function describeUse(item: TriggerItem, card: CardMessage, deps: TriggerDeps): UseDescription {
  const id = item.system?.id ?? "";
  const parent = item.parent && "getFlag" in item.parent ? item.parent : undefined;
  const weapon = deps.isStrike(item) || id === "strike" || id.startsWith("strike-") || parent?.type === "weapon";
  // The basic Strike action has no weapon behind it; assume melee until told otherwise.
  const melee = parent?.type === "weapon" ? parent.system?.attack?.type !== "ranged" : true;
  const normalised = deps.normalise(item);
  const d20 = card.rolls?.find((r) => r.dice?.[0]?.faces === 20);
  const picked = deps.pickedTarget(item);
  return {
    actionId: id || undefined,
    weapon,
    melee,
    attack: weapon || needsTarget(normalised),
    healsOther: false,
    d20: d20 ? d20.total : null,
    targets: targetsOf(card),
    pickedDef: picked ? defencesOf(fromUuidSync(picked)) : undefined,
    defence: defenceFromText(normalised.description),
  };
}

interface Collected {
  rules: TriggerRule[];
  sources: Record<string, string>;
  labels: Record<string, string>;
  missing: string[];
}

/** The follow-up on this actor by system id: an action itself, or the embedded action of a talent or power. */
function followUpAction(actor: TriggerActor, systemId: string): { item: TriggerItem; action: TriggerItem | null } | null {
  for (const item of actor.items) {
    if (item.system?.id !== systemId) continue;
    return { item, action: item.type === "action" ? item : (item.defaultAction ?? null) };
  }
  return null;
}

function collectRules(actor: TriggerActor, use: UseDescription): Collected {
  const out: Collected = { rules: [], sources: {}, labels: {}, missing: [] };
  for (const item of actor.items) {
    const { rules, invalid } = rulesOfItem(item);
    if (invalid) console.warn(`${MODULE_ID} | ${item.name}: trigger tag ignored (${invalid})`);
    for (const rule of rules) {
      if (!matchesKind(use, rule)) continue;
      out.rules.push(rule);
      out.sources[rule.id] = item.uuid;
      if (rule.effect === "follow-up" && rule.followUp) {
        const found = followUpAction(actor, rule.followUp);
        out.labels[rule.id] = found?.item.name ?? rule.followUp;
        if (!found?.action) out.missing.push(rule.id);
      } else if (rule.effect === "replacement-heal" && !item.system?.damage?.formula) {
        out.missing.push(rule.id);
      }
    }
  }
  return out;
}

async function onUse(item: TriggerItem | undefined, deps: TriggerDeps): Promise<void> {
  if (!item) return;
  if (followUps.has(item)) {
    followUps.set(item, true);
    return;
  }
  if (!enabled() || item.type !== "action" || !item.actor) return;
  const card = findCard(item);
  if (!card) return;
  const actor = item.actor;
  const use = describeUse(item, card, deps);
  const collected = collectRules(actor, use);
  const matches = matchTriggers(use, collected.rules);
  if (!matches.offers.length && !matches.askOutcome) return;
  const combat = combatPoint();
  const state: TriggerCardState = {
    sourceMessageId: card.id,
    actorUuid: actor.uuid,
    actorName: actor.name,
    use,
    rules: collected.rules,
    labels: collected.labels,
    sources: collected.sources,
    missing: collected.missing,
    taken: [],
    posted: combat && { combatId: combat.id, round: combat.round },
  };
  const messageId = await postTriggerCard(state, { speaker: card.speaker, whisper: card.whisper, blind: card.blind });
  await card.setFlag(MODULE_ID, SOURCE_FLAG, true);
  if (messageId) openTriggerPopup(messageId);
}

function combatPoint(): { id: string; round: number } | null {
  const combat = game.combats?.find((c: { active: boolean; started: boolean }) => c.active && c.started);
  return combat ? { id: combat.id, round: combat.round } : null;
}

async function recordLimit(state: TriggerCardState, rule: TriggerRule): Promise<void> {
  const combat = combatPoint();
  const source: TriggerItem | null = fromUuidSync(state.sources[rule.id]);
  if (rule.limit !== "round" || !combat || !source) return;
  const limits = source.getFlag<Record<string, unknown>>(MODULE_ID, LIMITS_FLAG) ?? {};
  await source.setFlag(MODULE_ID, LIMITS_FLAG, { ...limits, [rule.id]: { combatId: combat.id, round: combat.round } });
}

async function runFollowUp(state: TriggerCardState, offer: OfferView, deps: TriggerDeps): Promise<boolean> {
  const actor: TriggerActor | null = fromUuidSync(state.actorUuid);
  const found = actor && offer.rule.followUp ? followUpAction(actor, offer.rule.followUp) : null;
  const action = found?.action;
  if (!action) {
    ui.notifications.warn(localize("Triggers.Status.unavailable"));
    return false;
  }
  // "Spend no focus" turns the system's consumption off; otherwise its consume dialog charges the normal cost.
  const options = offer.cost === "waived" ? { shouldConsume: false } : {};
  followUps.set(action, false);
  try {
    await action.use(options);
    // A target-picker veto re-runs the use later; wait for that to finish.
    await deps.pickFlight(action);
    // `use()` returns nothing both when cancelled and for a successful action with no roll:
    // the system's use hook firing is what says it happened.
    return followUps.get(action) === true;
  } finally {
    followUps.delete(action);
  }
}

async function runFocusSpend(state: TriggerCardState, offer: OfferView): Promise<boolean> {
  const actor: TriggerActor | null = fromUuidSync(state.actorUuid);
  const amount = offer.rule.amount ?? 0;
  const focus = actor?.system?.resources?.foc?.value ?? 0;
  if (!actor || focus < amount) {
    ui.notifications.warn(localize("Triggers.NotEnoughFocus", { amount }));
    return false;
  }
  await actor.update({ "system.resources.foc.value": focus - amount });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${foundry.utils.escapeHTML(localize("Triggers.FocusSpent", { actor: actor.name, amount, name: offer.rule.name }))}</p>`,
  });
  return true;
}

async function runReplacementHeal(state: TriggerCardState, offer: OfferView): Promise<boolean> {
  const actor: TriggerActor | null = fromUuidSync(state.actorUuid);
  const source: TriggerItem | null = fromUuidSync(state.sources[offer.rule.id]);
  const formula = source?.system?.damage?.formula;
  if (!actor || !formula) return false;
  const roll = new foundry.dice.Roll(formula, actor.getRollData());
  await roll.evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: localize("Triggers.ReplacementHealFlavor", { name: offer.rule.name }),
  });
  await actor.applyHealing(roll.total as number);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${foundry.utils.escapeHTML(localize("Triggers.ReplacementHealNote", { name: offer.rule.name }))}</p>`,
  });
  return true;
}

async function chooseGrazeTarget(state: TriggerCardState): Promise<string | null> {
  const recorded = state.use.targets;
  if (recorded.length === 1) return recorded[0].uuid;
  if (recorded.length > 1) {
    const options = recorded.map((t) => {
      const doc: { name?: string } | null = fromUuidSync(t.uuid);
      return { uuid: t.uuid, name: doc?.name ?? t.uuid };
    });
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: localize("Triggers.Graze.ChooseTitle") },
      content: `<p>${foundry.utils.escapeHTML(localize("Triggers.Graze.Choose"))}</p>`,
      buttons: options.map((o) => ({ action: o.uuid, label: o.name })),
      rejectClose: false,
    });
    return typeof chosen === "string" ? chosen : null;
  }
  const actor: TriggerActor | null = fromUuidSync(state.actorUuid);
  const result = await pickTarget(localize("Triggers.Graze.Name"), "enemy", actor as never);
  return result.kind === "target" ? result.actorUuid : null;
}

async function runGraze(state: TriggerCardState): Promise<boolean> {
  const targetUuid = await chooseGrazeTarget(state);
  if (!targetUuid) return false;
  try {
    const response = await askGM<{ ok: true } | { ok: false; error: string }>("trigger.graze", {
      sourceMessageId: state.sourceMessageId,
      targetUuid,
    });
    if (response.ok) return true;
    ui.notifications.warn(localize(`Triggers.Graze.Error.${response.error}`));
  } catch (err) {
    ui.notifications.error(err instanceof Error ? err.message : String(err));
  }
  return false;
}

function dicePart(formula: string, data: Record<string, unknown>): string {
  const roll = new foundry.dice.Roll(formula, data);
  const kept = roll.terms.filter((t: unknown) => t instanceof foundry.dice.terms.DiceTerm || t instanceof foundry.dice.terms.OperatorTerm);
  const dice = kept.map((t: { formula: string }) => t.formula).join(" ").trim();
  return dice.replace(/^[+\-*/\s]+/, "").replace(/[+\-*/\s]+$/, "") || "0";
}

/**
 * GM side of a graze. Card contents are client-authored, so only the target
 * choice is taken from them, and only for the attacker's own card; the GM rolls
 * the item's graze dice itself and grazes each card once.
 */
async function graze(data: unknown, caller: QueryUser): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload = data && typeof data === "object" ? data : {};
  const sourceMessageId = "sourceMessageId" in payload ? payload.sourceMessageId : undefined;
  const targetUuid = "targetUuid" in payload ? payload.targetUuid : undefined;
  if (typeof sourceMessageId !== "string" || typeof targetUuid !== "string") return { ok: false, error: "unknown" };
  const message: CardMessage | undefined = game.messages.get(sourceMessageId);
  const itemUuid = message?.flags?.[SYSTEM_ID]?.message?.item;
  const item: TriggerItem | null = typeof itemUuid === "string" ? await fromUuid(itemUuid) : null;
  const attacker = item?.actor;
  if (!message || !item || !attacker) return { ok: false, error: "unknown" };
  if (message.author?.id !== caller.id || !attacker.testUserPermission(caller, "OWNER")) return { ok: false, error: "notOwner" };
  if (message.getFlag(MODULE_ID, "grazed")) return { ok: false, error: "alreadyGrazed" };
  const recorded = message.flags?.[SYSTEM_ID]?.message?.targets ?? [];
  if (recorded.length && !recorded.some((t) => t.uuid === targetUuid)) return { ok: false, error: "notTargeted" };
  const target: TriggerActor | null = await fromUuid(targetUuid);
  const attackerScenes = attacker.getDependentTokens().map((t) => t.parent);
  const onScene = target?.getDependentTokens().some((t) => attackerScenes.includes(t.parent));
  if (!target || !onScene) return { ok: false, error: "notOnScene" };

  const damage = item.system?.damage;
  const override = damage?.grazeOverrideFormula;
  const rollData = attacker.getRollData();
  const formula = override && !override.includes("@damage") ? override : dicePart(damage?.formula ?? "0", rollData);
  const roll = new foundry.dice.Roll(formula, rollData);
  await roll.evaluate();
  await message.setFlag(MODULE_ID, "grazed", targetUuid);
  try {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      flavor: localize("Triggers.Graze.Flavor", { attacker: attacker.name, target: target.name }),
    });
    await target.applyDamage([{ amount: roll.total as number, type: damage?.type ?? "impact" }]);
  } catch (err) {
    await message.setFlag(MODULE_ID, "grazed", false);
    throw err;
  }
  return { ok: true };
}

function makeHost(deps: TriggerDeps): TriggerHost {
  return {
    combat: combatPoint,
    limitRecord(state, ruleId) {
      const source: TriggerItem | null = fromUuidSync(state.sources[ruleId] ?? "");
      const limits: Record<string, { combatId: string; round: number }> | undefined = source?.getFlag(MODULE_ID, LIMITS_FLAG);
      return limits?.[ruleId] ?? null;
    },
    async use(state, offer) {
      let done = false;
      switch (offer.rule.effect) {
        case "follow-up":
          done = await runFollowUp(state, offer, deps);
          break;
        case "focus-spend":
          done = await runFocusSpend(state, offer);
          break;
        case "replacement-heal":
          done = await runReplacementHeal(state, offer);
          break;
        case "graze":
          done = await runGraze(state);
          break;
        case "heal-bonus":
          break;
      }
      if (done) await recordLimit(state, offer.rule);
      return done;
    },
  };
}

/** Register the setting, the graze query, the offer surfaces and the use hook. */
export function registerCosmereTriggers(deps: TriggerDeps): void {
  game.settings.register(MODULE_ID, ENABLED_SETTING, {
    name: "TABLE_LEDGER.Triggers.Settings.Enabled.Name",
    hint: "TABLE_LEDGER.Triggers.Settings.Enabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  registerQuery("trigger.graze", serialize(graze), { access: "player" });
  registerTriggerOffers(makeHost(deps));
  Hooks.on(`${SYSTEM_ID}.useItem`, (item: TriggerItem | undefined) => void onUse(item, deps));
}
