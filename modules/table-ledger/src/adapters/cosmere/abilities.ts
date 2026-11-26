// Cosmere RPG target picker, heal prompts, talent hints and audit data access.
// Talks to the system only through its hooks, settings and document data (KTD3).
import { MODULE_ID, localize } from "../../constants";
import type { AbilityAdapter, AbilityFix, AbilityRecord, ChargeInfo } from "../types";
import { ApplyButtonsTo, applyTargetCount, normaliseAction, usesWeaponStrike } from "../../abilities/audit-rules";
import { consumableCounter, consumptionEntry, firstCounter } from "../../abilities/charges";
import { pickedTargetLingers, shouldPickTarget, targetSide } from "../../abilities/targeting";
import { pickTarget } from "../../abilities/target-picker";
import { registerHealPrompt, requestHealing } from "../../abilities/heal-prompt";
import { ALLY_ACTION_IDS, healRequestFor, type HealTarget, type HealerActor } from "./healing";
import { registerCosmereTriggers } from "./triggers";
import { onRenderItemSheet } from "./trigger-sheet";
import { ensureImprovisedActions, registerImprovisedStrike } from "./improvised";
import { attackAdjustment, noGrazeHint, registerIllusion } from "./illusion";
import { makesStrike, registerStrikeAbilities } from "./strike-abilities";

const SYSTEM_ID = "cosmere-rpg";
const GUARDS_SETTING = "abilityGuards";
const PROMPTED_SETTING = "applyButtonsPrompted";
const HEAL_SETTING = "healPrompts";
const APPLY_ACTIONS: Record<string, true> = { "apply-damage": true, "reduce-focus": true };
const STRIKE_SETTING = "strikeTargeting";

/** The slice of a CosmereItem this adapter reads and writes. */
interface CosmereItemDoc {
  name: string;
  uuid: string;
  type: string;
  isEphemeral?: boolean;
  system?: {
    id?: string;
    description?: { value?: string | null };
    activation?: { type?: string | null; consumption?: { type?: string; resource?: string }[] };
    damage?: { formula?: string | null; type?: string | null };
    resources?: Record<string, { value?: number | null; max?: number | null } | null>;
  };
  actor?: (HealerActor & { id: string; uuid: string; img?: string; type: string; hasPlayerOwner: boolean }) | null;
  items?: Iterable<CosmereItemDoc>;
  getFlag?(scope: string, key: string): unknown;
  update(data: Record<string, unknown>): Promise<unknown>;
  use(options: Record<string, unknown>): Promise<unknown>;
}

interface CosmereMessage {
  flags?: Record<string, { message?: { item?: unknown } } | undefined>;
  speaker?: unknown;
  getFlag(scope: string, key: string): unknown;
}

/** Items whose use was confirmed through the picker and is being re-run. */
const inFlight = new WeakSet<CosmereItemDoc>();
/** Target chosen in the picker, for the heal prompt (off-scene party members have no token to target). */
const pickedTargets = new WeakMap<object, string>();
/** Target-picker flows in progress (a veto and its later re-run), for callers that need to wait for the real use. */
const pickFlights = new WeakMap<object, Promise<void>>();
/** Token the picker targeted last; it stays targeted so the card's Apply buttons still find it. */
let pickedToken: string | null = null;

const FIX_UPDATES: Record<Exclude<AbilityFix, "consumeCharge">, Record<string, unknown>> = {
  clearDamage: { "system.damage.formula": null },
  setUtility: { "system.activation.type": "utility" },
};

function normalise(doc: Pick<CosmereItemDoc, "name" | "system">) {
  return {
    ...normaliseAction({
      name: doc.name,
      descriptionHtml: doc.system?.description?.value,
      activationType: doc.system?.activation?.type,
      damageFormula: doc.system?.damage?.formula,
      damageType: doc.system?.damage?.type,
    }),
    id: doc.system?.id,
  };
}

function guardsEnabled(): boolean {
  return game.settings.get(MODULE_ID, GUARDS_SETTING) === true;
}

/** Weapon strikes are rebuilt from the weapon on every prepare; they can't be edited. */
function isStrike(doc: Pick<CosmereItemDoc, "getFlag">): boolean {
  return !!doc.getFlag?.(SYSTEM_ID, "isStrike");
}

function isEphemeral(doc: CosmereItemDoc): boolean {
  return doc.isEphemeral === true || isStrike(doc);
}

function onPreUseItem(item: CosmereItemDoc | undefined, options: Record<string, unknown>): false | void {
  if (!item || item.type !== "action") return;
  // A re-run already carries its pick and its adjusted roll.
  if (inFlight.has(item)) return;
  // A fresh click forgets any earlier pick.
  pickedTargets.delete(item);
  const targets: Iterable<{ id: string }> = game.user.targets;
  const lingering = pickedTargetLingers(pickedToken, [...targets].map((t) => t.id));
  // Strikes are rolled against whatever the player targets, if anything: no picker unless asked for,
  // or the target is one the picker left behind for an earlier ability.
  const strikeAsIs = isStrike(item) && game.settings.get(MODULE_ID, STRIKE_SETTING) !== true && !lingering;
  const side = targetSide(normalise(item), ALLY_ACTION_IDS);
  const pick =
    !strikeAsIs &&
    shouldPickTarget({
      enabled: guardsEnabled(),
      reentering: false,
      side,
      targetCount: lingering ? 0 : game.user.targets.size,
    });
  // Veto before the system's consume dialog, so nothing is spent until a target is chosen.
  if (pick && side) {
    pickFlights.set(item, pickThenUse(item, side, options, lingering ? (pickedToken ?? undefined) : undefined));
    return false;
  }
  const adjusted = attackAdjustment(item, options);
  if (!adjusted) return;
  pickFlights.set(item, rerun(item, adjusted));
  return false;
}

async function pickThenUse(item: CosmereItemDoc, side: "enemy" | "ally", options: Record<string, unknown>, preselect?: string) {
  const result = await pickTarget(item.name, side, item.actor ?? null, preselect);
  if (result.kind === "cancel") return;
  pickedToken = result.kind === "target" ? (result.tokenId ?? null) : null;
  if (result.kind === "target") pickedTargets.set(item, result.actorUuid);
  await rerun(item, attackAdjustment(item, options) ?? options);
}

/**
 * Use the item again after a veto. `options` is the hook copy: it already
 * carries the resolved actor, roll mode and configuration mode, so the re-run
 * behaves like the original click.
 */
async function rerun(item: CosmereItemDoc, options: Record<string, unknown>) {
  inFlight.add(item);
  try {
    await item.use(options);
  } finally {
    inFlight.delete(item);
  }
}

/** After a use: ask the target to roll target-rolled heals (Field Medicine, Regrowth). */
async function onUseItem(item: CosmereItemDoc | undefined): Promise<void> {
  if (!item || item.type !== "action" || !item.actor || game.settings.get(MODULE_ID, HEAL_SETTING) !== true) return;
  const firstTarget: { actor?: HealTarget | null } | undefined = game.user.targets.first?.();
  const targetUuid = pickedTargets.get(item) ?? firstTarget?.actor?.uuid;
  pickedTargets.delete(item);
  const target: HealTarget | null = targetUuid ? fromUuidSync(targetUuid) : null;
  if (!target) return;
  // The card the system just posted for this use carries the test's d20.
  const messages: (CosmereMessage & { author?: { id: string }; rolls?: { total: number; dice?: { faces: number }[] }[] })[] =
    game.messages.contents;
  const card = messages.findLast((m) => m.author?.id === game.user.id && messageItem(m)?.uuid === item.uuid);
  const d20 = card?.rolls?.find((r) => r.dice?.[0]?.faces === 20);
  const request = healRequestFor(item, item.actor, target, d20 ? d20.total : null);
  if (request) await requestHealing(request, ChatMessage.getSpeaker({ actor: item.actor }));
}

function onChatMessageInteract(_message: unknown, event: { currentTarget?: unknown } | undefined): void {
  if (!guardsEnabled()) return;
  const button = event?.currentTarget;
  if (!(button instanceof HTMLElement) || !button.closest(".apply-buttons")) return;
  if (!APPLY_ACTIONS[button.dataset.action ?? ""]) return;
  const setting = Number(game.settings.get(SYSTEM_ID, "applyButtonsTo"));
  const selected = game.canvas?.tokens?.controlled?.length ?? 0;
  const targeted = game.user.targets.size;
  if (applyTargetCount(setting, selected, targeted) > 0) return;
  const key =
    setting === ApplyButtonsTo.SelectedOnly
      ? "Abilities.Apply.NeedSelected"
      : setting === ApplyButtonsTo.TargetedOnly
        ? "Abilities.Apply.NeedTargeted"
        : "Abilities.Apply.NeedEither";
  ui.notifications.warn(localize(key));
}

/** The item a cosmere-rpg action card was posted for: a UUID from `use()`, an id from `toChatMessage()`. */
function messageItem(message: CosmereMessage): CosmereItemDoc | null {
  const ref = message.flags?.[SYSTEM_ID]?.message?.item;
  if (typeof ref !== "string" || !ref) return null;
  if (ref.includes(".")) return fromUuidSync(ref) ?? null;
  return ChatMessage.getSpeakerActor(message.speaker)?.items?.get(ref) ?? null;
}

/** How long to keep re-applying a hint after render (see `attachHint`). */
const HINT_SETTLE_MS = 3000;

function appendHint(html: HTMLElement, iconClass: string, text: string): void {
  if (html.querySelector(".tl-abilities-hint")) return;
  const hint = document.createElement("p");
  hint.className = "tl-abilities-hint";
  const icon = document.createElement("i");
  icon.className = iconClass;
  hint.append(icon, " ", text);
  (html.querySelector(".chat-card") ?? html.querySelector(".message-content") ?? html).append(hint);
}

/**
 * cosmere-rpg's own renderChatMessageHTML handler is async and replaces the
 * card content after every hook has returned, dropping anything appended
 * synchronously. Re-append whenever the content is swapped while it settles.
 */
function attachHint(html: HTMLElement, iconClass: string, text: string): void {
  appendHint(html, iconClass, text);
  const observer = new MutationObserver(() => appendHint(html, iconClass, text));
  observer.observe(html, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), HINT_SETTLE_MS);
}

function onRenderChatMessage(message: CosmereMessage, html: HTMLElement): void {
  const cantGraze = noGrazeHint(message);
  if (cantGraze) {
    attachHint(html, "fa-solid fa-ghost", cantGraze);
    return;
  }
  const item = messageItem(message);
  if (!item) return;
  if (item.type === "talent") {
    const names = [...(item.items ?? [])].filter((child) => child.type === "action").map((child) => child.name);
    if (names.length) attachHint(html, "fa-solid fa-hand-pointer", localize("Abilities.TalentHint", { names: names.join(", ") }));
    return;
  }
  // "Make a melee attack…" on a Utility action: the card is the effect; the roll is a weapon Strike
  // (which the module makes itself for the abilities it knows).
  if (item.type === "action" && !makesStrike(item) && usesWeaponStrike(normalise(item))) {
    attachHint(html, "fa-solid fa-khanda", localize("Abilities.StrikeHint"));
  }
}

const COUNTER_ICONS: Record<string, string> = {
  charges: "fa-solid fa-bolt",
  uses: "fa-regular fa-circle-check",
  ammo: "fa-solid fa-burst",
};

/**
 * The sheet's equipment and action rows show an item's counter only once its
 * primary resource is set; otherwise the cell reads "—". Fill those cells with
 * the first counter the item has (read-only: the +/- buttons need a primary).
 */
function showCounters(root: HTMLElement, actor: { items: { get(id: string): CosmereItemDoc | undefined } }): void {
  for (const cell of root.querySelectorAll<HTMLElement>(".detail.resource > .val.none")) {
    const row = cell.closest<HTMLElement>("[data-item-uuid], [data-item-id]");
    const item: CosmereItemDoc | null | undefined = row?.dataset.itemUuid
      ? fromUuidSync(row.dataset.itemUuid)
      : row?.dataset.itemId
        ? actor.items.get(row.dataset.itemId)
        : null;
    const counter = firstCounter(item?.system?.resources);
    if (!counter) continue;
    const badge = document.createElement("div");
    badge.className = "tl-counter";
    const kind = counter.key[0].toUpperCase() + counter.key.slice(1);
    badge.dataset.tooltip = game.i18n.localize(`COSMERE.Item.Resource.Types.${kind}.Plural`);
    const icon = document.createElement("i");
    icon.className = COUNTER_ICONS[counter.key] ?? "";
    badge.append(`${counter.value}/${counter.max} `, icon);
    cell.replaceWith(badge);
  }
}

function onRenderSheet(app: { document?: { documentName?: string; items?: unknown }; element?: HTMLElement }, html: HTMLElement): void {
  const actor = app.document;
  const root = app.element ?? html;
  if (actor?.documentName !== "Actor" || !actor.items || root.dataset.tlCounters) return;
  // Sheet tabs re-render on their own (item edits, +/- clicks), without another render hook.
  root.dataset.tlCounters = "1";
  const run = () => showCounters(root, actor as Parameters<typeof showCounters>[1]);
  new MutationObserver(run).observe(root, { childList: true, subtree: true });
  run();
}

function record(doc: CosmereItemDoc, location: string, charges?: ChargeInfo): AbilityRecord {
  return { ...normalise(doc), ...(charges && { charges }), ref: doc, uuid: doc.uuid, location };
}

/** Embedded actions the audit (and the charge fix) can edit. */
function embeddedActions(item: CosmereItemDoc): CosmereItemDoc[] {
  return [...(item.items ?? [])].filter((child) => child.type === "action" && !isEphemeral(child));
}

/** An item with charges or ammo, and whether one of its actions already spends it. */
function chargeInfo(item: CosmereItemDoc, actions: CosmereItemDoc[]): ChargeInfo | undefined {
  if (item.type === "action" || !actions.length) return undefined;
  const counter = consumableCounter(item.system?.resources);
  if (!counter) return undefined;
  const consumed = actions.some((action) =>
    (action.system?.activation?.consumption ?? []).some((c) => c.type === "item_resource" && c.resource === counter.key),
  );
  return { key: counter.key, consumed, actionCount: actions.length };
}

/** The item itself when it is an action, an item with unspent charges, and its embedded actions. */
function collect(item: CosmereItemDoc, owner: string, out: AbilityRecord[]) {
  if (isEphemeral(item)) return;
  if (item.type === "action") out.push(record(item, owner));
  const actions = embeddedActions(item);
  const charges = chargeInfo(item, actions);
  if (charges) out.push(record(item, owner, charges));
  for (const child of actions) out.push(record(child, `${owner} › ${item.name}`));
}

export const cosmereAbilities: AbilityAdapter = {
  register() {
    game.settings.register(MODULE_ID, GUARDS_SETTING, {
      // Core localizes setting labels when rendering; i18n isn't ready during init.
      name: "TABLE_LEDGER.Abilities.Settings.Guards.Name",
      hint: "TABLE_LEDGER.Abilities.Settings.Guards.Hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });
    game.settings.register(MODULE_ID, PROMPTED_SETTING, {
      scope: "client",
      config: false,
      type: Boolean,
      default: false,
    });
    game.settings.register(MODULE_ID, HEAL_SETTING, {
      name: "TABLE_LEDGER.Abilities.Settings.HealPrompts.Name",
      hint: "TABLE_LEDGER.Abilities.Settings.HealPrompts.Hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });
    game.settings.register(MODULE_ID, STRIKE_SETTING, {
      name: "TABLE_LEDGER.Abilities.Settings.StrikeTargeting.Name",
      hint: "TABLE_LEDGER.Abilities.Settings.StrikeTargeting.Hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
    });
    // cosmere-rpg: applyHealing(amount) → applyDamage([{ amount, type: Healing }]).
    registerHealPrompt(async (actor, amount) => {
      if (!("applyHealing" in actor) || typeof actor.applyHealing !== "function") {
        throw new Error(`${actor.name} can't be healed (no applyHealing).`);
      }
      return actor.applyHealing(amount);
    });
    // Registered before the heal hook below: they read the picked target, which the heal hook clears.
    registerCosmereTriggers({
      isStrike,
      normalise,
      pickedTarget: (item) => pickedTargets.get(item),
      pickFlight: (item) => pickFlights.get(item),
    });
    registerIllusion({ pickedTarget: (item) => pickedTargets.get(item) });
    registerStrikeAbilities();
    registerImprovisedStrike();
    Hooks.on(`${SYSTEM_ID}.preUseItem`, onPreUseItem);
    Hooks.on(`${SYSTEM_ID}.useItem`, (item: CosmereItemDoc | undefined) => void onUseItem(item));
    Hooks.on(`${SYSTEM_ID}.chatMessageInteract`, onChatMessageInteract);
    Hooks.on("renderChatMessageHTML", onRenderChatMessage);
    Hooks.on("renderApplicationV2", onRenderSheet);
    Hooks.on("renderApplicationV2", onRenderItemSheet);
  },

  ready() {
    void ensureImprovisedActions();
    if (game.settings.get(MODULE_ID, PROMPTED_SETTING)) return;
    void (async () => {
      await game.settings.set(MODULE_ID, PROMPTED_SETTING, true);
      if (Number(game.settings.get(SYSTEM_ID, "applyButtonsTo")) !== ApplyButtonsTo.SelectedOnly) return;
      const howTo = !guardsEnabled()
        ? "Abilities.Onboarding.HowToKey"
        : game.settings.get(MODULE_ID, STRIKE_SETTING) === true
          ? "Abilities.Onboarding.HowToPickerAll"
          : "Abilities.Onboarding.HowToPicker";
      const accept = await foundry.applications.api.DialogV2.confirm({
        window: { title: localize("Abilities.Onboarding.Title"), icon: "fa-solid fa-bullseye" },
        content: `<p>${localize("Abilities.Onboarding.Content", { howTo: localize(howTo) })}</p>`,
        yes: { label: localize("Abilities.Onboarding.Accept") },
        no: { label: localize("Abilities.Onboarding.Decline") },
        rejectClose: false,
      });
      if (!accept) return;
      await game.settings.set(SYSTEM_ID, "applyButtonsTo", ApplyButtonsTo.PrioritiseTargeted);
      foundry.utils.debouncedReload();
    })();
  },

  scan() {
    const out: AbilityRecord[] = [];
    const worldLabel = localize("Abilities.Audit.WorldItems");
    for (const item of game.items as Iterable<CosmereItemDoc>) collect(item, worldLabel, out);
    for (const actor of game.actors as Iterable<{ name: string; items: Iterable<CosmereItemDoc> }>) {
      for (const item of actor.items) collect(item, actor.name, out);
    }
    return out;
  },

  async applyFix(ref, fix) {
    // `ref` is the document handed out by `scan()`.
    const doc = ref as CosmereItemDoc;
    if (fix === "consumeCharge") {
      const counter = consumableCounter(doc.system?.resources);
      const [action] = embeddedActions(doc);
      if (!counter || !action) throw new Error(`${doc.name}: nothing to attach the charge cost to.`);
      const existing = action.system?.activation?.consumption ?? [];
      await action.update({ "system.activation.consumption": [...existing, consumptionEntry(counter.key)] });
      return;
    }
    await doc.update(FIX_UPDATES[fix]);
  },
};
