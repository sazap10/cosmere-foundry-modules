// Offers for optional ability triggers: one chat card per use, plus a popup for
// the acting user. The card's message flag holds all state, so a dismissed popup
// loses nothing. System-neutral: the adapter supplies what "using" an offer does.
import { MODULE_ID, localize, template } from "../constants";
import {
  describeCard,
  type CardView,
  type CombatPoint,
  type OfferStatus,
  type OfferView,
  type Outcome,
  type TriggerCardState,
} from "./triggers";

const FLAG = "trigger";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export interface TriggerHost {
  /** The combat the user's actor is in, or null outside combat. */
  combat(): CombatPoint | null;
  /** When the offer's talent last used a once-per-round rule. */
  limitRecord(state: TriggerCardState, ruleId: string): { combatId: string; round: number } | null;
  /** Carry the offer out (and record any limit). Resolves true when it happened. */
  use(state: TriggerCardState, offer: OfferView): Promise<boolean>;
}

let host: TriggerHost | null = null;

interface TriggerMessage {
  id: string;
  author?: { id: string };
  whisper?: string[];
  blind?: boolean;
  speaker?: unknown;
  getFlag(scope: string, key: string): unknown;
  update(data: Record<string, unknown>): Promise<unknown>;
}

const messageOf = (id: string): TriggerMessage | undefined => game.messages.get(id);

export function stateOf(message: Pick<TriggerMessage, "getFlag"> | undefined): TriggerCardState | null {
  const flag = message?.getFlag(MODULE_ID, FLAG);
  return flag && typeof flag === "object" && "rules" in flag ? (flag as TriggerCardState) : null;
}

/** Only the user who used the action, and GMs, can take an offer: they can edit the card. */
export const canUse = (message: Pick<TriggerMessage, "author">): boolean => game.user.isGM || message.author?.id === game.user.id;

function viewOf(state: TriggerCardState): CardView {
  return describeCard(state, host?.combat() ?? null, (ruleId) => host?.limitRecord(state, ruleId) ?? null);
}

function summary(offer: OfferView, state: TriggerCardState): string {
  const { rule } = offer;
  const name = state.labels[rule.id] ?? rule.followUp ?? rule.name;
  switch (rule.effect) {
    case "follow-up":
      return localize(offer.cost === "waived" ? "Triggers.Summary.followUpFree" : "Triggers.Summary.followUp", { name });
    case "graze":
      return localize("Triggers.Summary.graze");
    case "focus-spend":
      return localize("Triggers.Summary.focusSpend", { amount: rule.amount ?? 0 });
    case "replacement-heal":
      return localize("Triggers.Summary.replacementHeal");
    case "heal-bonus":
      return rule.name;
  }
}

const STATUS_KEYS: Record<Exclude<OfferStatus, "open">, string> = {
  taken: "Triggers.Status.taken",
  unavailable: "Triggers.Status.unavailable",
  expired: "Triggers.Status.expired",
  spent: "Triggers.Status.spent",
};

/** Template data shared by the card and the popup. All text is escaped by the templates. */
function viewModel(state: TriggerCardState, skipped: ReadonlySet<string> = new Set()) {
  const view = viewOf(state);
  return {
    heading: localize("Triggers.Heading", { actor: state.actorName }),
    askOutcome: view.askOutcome,
    offers: view.offers
      .filter((offer) => !skipped.has(offer.rule.id))
      .map((offer) => ({
        id: offer.rule.id,
        name: offer.rule.name,
        summary: summary(offer, state),
        note: offer.rule.note,
        open: offer.status === "open",
        statusLabel: offer.status === "open" ? "" : localize(STATUS_KEYS[offer.status]),
        status: offer.status,
      })),
  };
}

function cardHtml(state: TriggerCardState): Promise<string> {
  return foundry.applications.handlebars.renderTemplate(template("abilities/trigger-card.hbs"), viewModel(state));
}

/** Post the card for one use, with the same visibility as the action's own card. */
export async function postTriggerCard(
  state: TriggerCardState,
  source: { speaker: unknown; whisper?: string[]; blind?: boolean },
): Promise<string | null> {
  const message = await ChatMessage.create({
    speaker: source.speaker,
    whisper: source.whisper ?? [],
    blind: source.blind ?? false,
    content: await cardHtml(state),
    flags: { [MODULE_ID]: { [FLAG]: state } },
  });
  return message?.id ?? null;
}

async function save(message: TriggerMessage, state: TriggerCardState): Promise<void> {
  await message.update({ content: await cardHtml(state), [`flags.${MODULE_ID}.${FLAG}`]: state });
}

const pending = new Set<string>();
const saves = new Map<string, Promise<unknown>>();

/** Run `task` after earlier saves to the same card, so concurrent offers can't overwrite each other's taken mark. */
function inOrder(messageId: string, task: () => Promise<void>): Promise<void> {
  const run = (saves.get(messageId) ?? Promise.resolve()).then(task, task);
  saves.set(messageId, run);
  return run.finally(() => {
    if (saves.get(messageId) === run) saves.delete(messageId);
  });
}

/** Use one offer from the popup or the card. Re-checks everything against the card's current state. */
export async function useOffer(messageId: string, ruleId: string): Promise<void> {
  const message = messageOf(messageId);
  const state = stateOf(message);
  if (!message || !state || !host) return;
  if (!canUse(message)) return;
  const offer = viewOf(state).offers.find((o) => o.rule.id === ruleId);
  // A once-per-round talent is locked by the talent, so a sibling card can't start a second use meanwhile.
  const key = offer?.rule.limit === "round" ? `${state.sources[ruleId]}:${ruleId}` : `${messageId}:${ruleId}`;
  if (pending.has(key)) return;
  if (!offer || offer.status !== "open") {
    ui.notifications.warn(offer && offer.status !== "open" ? localize(STATUS_KEYS[offer.status]) : localize("Triggers.Status.expired"));
    refresh(messageId);
    return;
  }
  pending.add(key);
  try {
    if (!(await host.use(state, offer))) return;
    await inOrder(messageId, async () => {
      const fresh = stateOf(messageOf(messageId)) ?? state;
      await save(message, { ...fresh, taken: [...new Set([...fresh.taken, ruleId])] });
    });
  } catch (err) {
    ui.notifications.error(err instanceof Error ? err.message : String(err));
  } finally {
    pending.delete(key);
  }
}

/** Answer the Hit/Miss question for an outcome that couldn't be computed. */
export async function answerOutcome(messageId: string, outcome: Outcome): Promise<void> {
  const message = messageOf(messageId);
  const state = stateOf(message);
  if (!message || !state || state.answer || !canUse(message)) return;
  await save(message, { ...state, answer: outcome });
}

const popups = new Map<string, TriggerPopup>();

function refresh(messageId: string): void {
  void popups.get(messageId)?.render();
  const message = messageOf(messageId);
  if (message) ui.chat?.updateMessage?.(message, false);
}

class TriggerPopup extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["tl-abilities-trigger-popup"],
    window: { title: "TABLE_LEDGER.Triggers.PopupTitle", icon: "fa-solid fa-bolt" },
    position: { width: 380 },
    actions: {
      use: TriggerPopup.#onUse,
      skip: TriggerPopup.#onSkip,
      answer: TriggerPopup.#onAnswer,
      dismiss: TriggerPopup.#onDismiss,
    },
  };

  static PARTS = { body: { template: template("abilities/trigger-popup.hbs") } };

  readonly #messageId: string;
  readonly #skipped = new Set<string>();

  constructor(messageId: string) {
    super({ id: `tl-trigger-${messageId}` });
    this.#messageId = messageId;
  }

  async _prepareContext() {
    const state = stateOf(messageOf(this.#messageId));
    return state ? viewModel(state, this.#skipped) : { heading: "", askOutcome: false, offers: [] };
  }

  async _onRender(...args: unknown[]) {
    await (super._onRender as (...a: unknown[]) => Promise<void>)(...args);
    // The card still holds whatever stays open.
    const state = stateOf(messageOf(this.#messageId));
    const view = state ? viewModel(state, this.#skipped) : null;
    if (!view || (!view.askOutcome && !view.offers.some((o) => o.open))) void this.close();
  }

  async _onClose(...args: unknown[]) {
    popups.delete(this.#messageId);
    await (super._onClose as (...a: unknown[]) => Promise<void>)(...args);
  }

  static #ruleId(target: HTMLElement): string | undefined {
    return target.closest<HTMLElement>("[data-rule-id]")?.dataset.ruleId;
  }

  static async #onUse(this: TriggerPopup, _event: Event, target: HTMLElement) {
    const ruleId = TriggerPopup.#ruleId(target);
    if (ruleId) await useOffer(this.#messageId, ruleId);
  }

  static #onSkip(this: TriggerPopup, _event: Event, target: HTMLElement) {
    const ruleId = TriggerPopup.#ruleId(target);
    if (ruleId) this.#skipped.add(ruleId);
    void this.render();
  }

  static async #onAnswer(this: TriggerPopup, _event: Event, target: HTMLElement) {
    const outcome = target.dataset.outcome;
    if (outcome === "hit" || outcome === "miss") await answerOutcome(this.#messageId, outcome);
  }

  static #onDismiss(this: TriggerPopup) {
    void this.close();
  }
}

/** Open the popup for a posted card (the acting user's client). */
export function openTriggerPopup(messageId: string): void {
  let popup = popups.get(messageId);
  if (!popup) {
    popup = new TriggerPopup(messageId);
    popups.set(messageId, popup);
  }
  void popup.render({ force: true });
}

/** Wire the card's buttons and keep both surfaces current. Called once, with the adapter's host. */
export function registerTriggerOffers(triggerHost: TriggerHost): void {
  host = triggerHost;

  Hooks.on("renderChatMessageHTML", (message: TriggerMessage, html: HTMLElement) => {
    const state = stateOf(message);
    const card = html.querySelector<HTMLElement>(".tl-abilities-trigger");
    if (!state || !card) return;
    // The stored HTML is a snapshot; redraw so expiry and limits show as they are now.
    void cardHtml(state).then((fresh) => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = fresh;
      const next = wrapper.firstElementChild as HTMLElement | null;
      if (!next) return;
      card.replaceWith(next);
      if (!canUse(message)) {
        next.querySelectorAll("button").forEach((button) => button.remove());
        return;
      }
      next.querySelectorAll<HTMLButtonElement>("[data-action='tl-trigger-use']").forEach((button) =>
        button.addEventListener("click", () => void useOffer(message.id, button.dataset.ruleId ?? "")),
      );
      next.querySelectorAll<HTMLButtonElement>("[data-action='tl-trigger-answer']").forEach((button) =>
        button.addEventListener("click", () => {
          const outcome = button.dataset.outcome;
          if (outcome === "hit" || outcome === "miss") void answerOutcome(message.id, outcome);
        }),
      );
    });
  });

  // A card updated anywhere (taken on another client, a sibling card's limit) refreshes its popup here.
  Hooks.on("updateChatMessage", (message: TriggerMessage) => {
    if (popups.has(message.id)) void popups.get(message.id)?.render();
  });

  // The round moved on or the combat ended: cards and popups re-draw as expired.
  const redrawAll = () => {
    for (const message of game.messages.contents as TriggerMessage[]) {
      if (!stateOf(message)) continue;
      ui.chat?.updateMessage?.(message, false);
      void popups.get(message.id)?.render();
    }
  };
  Hooks.on("updateCombat", (_combat: unknown, changes: Record<string, unknown>) => {
    if ("round" in changes || "active" in changes || "started" in changes) redrawAll();
  });
  Hooks.on("deleteCombat", redrawAll);
}
