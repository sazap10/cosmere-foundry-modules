// Prompted healing: after a healing ability is used, the target's owner is
// asked to roll their healing (e.g. their recovery die for Field Medicine).
// A chat card carries the request so it survives a dismissed pop-up; the
// pop-up is sent to the target's online owners. System-neutral: the adapter
// supplies how healing is applied.
import { MODULE_ID, localize, template } from "../constants";
import { askGM, registerClientQuery, registerQuery, serialize, type QueryUser } from "../queries";

export interface HealRequest {
  targetUuid: string;
  targetName: string;
  healerName: string;
  ability: string;
  formula: string;
  /** Extra context, e.g. "Medicine test 18 vs DC 15: success". */
  note?: string;
  /** Regrowth-style heals are rolled again each turn. */
  repeatable: boolean;
  rolls: { total: number; by: string; at: string }[];
}

interface HealActor {
  uuid: string;
  name: string;
  isOwner: boolean;
  getRollData(): Record<string, unknown>;
  testUserPermission(user: unknown, level: "OWNER"): boolean;
}

type ApplyHealing = (actor: HealActor, amount: number) => Promise<unknown>;

const FLAG = "heal";
let applyHealing: ApplyHealing | null = null;

function requestOf(message: { getFlag(scope: string, key: string): unknown } | undefined): HealRequest | null {
  const flag = message?.getFlag(MODULE_ID, FLAG);
  return flag && typeof flag === "object" && "targetUuid" in flag ? (flag as HealRequest) : null;
}

function cardHtml(request: HealRequest): Promise<string> {
  const last = request.rolls.at(-1);
  return foundry.applications.handlebars.renderTemplate(template("abilities/heal-card.hbs"), {
    ...request,
    heading: localize("Abilities.Heal.CardHeading", { healer: request.healerName, ability: request.ability, target: request.targetName }),
    rollLabel: localize("Abilities.Heal.Roll", { formula: request.formula }),
    done: !request.repeatable && request.rolls.length > 0,
    // Not `last`: a registered Handlebars helper of that name shadows the field.
    result: last ? localize("Abilities.Heal.Rolled", { name: request.targetName, total: last.total }) : null,
  });
}

/** Post the request card and pop the prompt up for the target's owners. */
export async function requestHealing(request: Omit<HealRequest, "rolls">, speaker: unknown): Promise<void> {
  const full: HealRequest = { ...request, rolls: [] };
  const message = await ChatMessage.create({
    speaker,
    content: await cardHtml(full),
    flags: { [MODULE_ID]: { [FLAG]: full } },
  });
  const target: HealActor | null = fromUuidSync(request.targetUuid);
  if (!message || !target) return;
  // Prefer the target's players; fall back to the GM for NPCs or absent players.
  const users: { id: string; active: boolean; isGM: boolean; query: Function }[] = game.users.contents;
  const owners = users.filter((u) => u.active && !u.isGM && target.testUserPermission(u, "OWNER"));
  const recipients = owners.length ? owners : users.filter((u) => u.active && u.isGM).slice(0, 1);
  for (const user of recipients) {
    if (user.id === game.user.id) void promptRoll(message.id);
    else user.query(`${MODULE_ID}.heal.prompt`, { messageId: message.id }, { timeout: 5_000 }).catch(() => undefined);
  }
}

async function promptRoll(messageId: string): Promise<void> {
  const request = requestOf(game.messages.get(messageId));
  if (!request) return;
  const roll = await foundry.applications.api.DialogV2.confirm({
    window: { title: localize("Abilities.Heal.PromptTitle"), icon: "fa-solid fa-heart-pulse" },
    content: `<p>${foundry.utils.escapeHTML(
      localize("Abilities.Heal.PromptContent", { healer: request.healerName, ability: request.ability, target: request.targetName }),
    )}</p>${request.note ? `<p>${foundry.utils.escapeHTML(request.note)}</p>` : ""}`,
    yes: { label: localize("Abilities.Heal.Roll", { formula: request.formula }), icon: "fa-solid fa-dice" },
    no: { label: localize("Abilities.Heal.Later") },
    rejectClose: false,
  });
  if (roll) await rollHealing(messageId);
}

type HealResponse = { ok: true; total: number } | { ok: false; error: "unknownRequest" | "notOwner" | "alreadyRolled" };

/** Ask the GM to roll the requested healing for the target and apply it. */
export async function rollHealing(messageId: string): Promise<void> {
  let response: HealResponse;
  try {
    response = await askGM<HealResponse>("heal.roll", { messageId });
  } catch (err) {
    ui.notifications.error(err instanceof Error ? err.message : String(err));
    return;
  }
  if (response.ok) return;
  const request = requestOf(game.messages.get(messageId));
  if (response.error === "notOwner") ui.notifications.warn(localize("Abilities.Heal.NotOwner", { name: request?.targetName ?? "" }));
  else if (response.error === "alreadyRolled") ui.notifications.info(localize("Abilities.Heal.AlreadyRolled"));
}

/**
 * GM side of a heal (serialised: two owners clicking at once can't both pass
 * the non-repeatable check). The GM rolls, so a client can't choose its total,
 * and the request is recorded before healing is applied.
 */
async function healRoll(data: unknown, user: QueryUser): Promise<HealResponse> {
  const messageId = typeof data === "object" && data && "messageId" in data ? data.messageId : null;
  const message = typeof messageId === "string" ? game.messages.get(messageId) : undefined;
  const request = requestOf(message);
  if (!message || !request || !applyHealing) return { ok: false, error: "unknownRequest" };
  const actor: HealActor | null = await fromUuid(request.targetUuid);
  if (!actor || !actor.testUserPermission(user, "OWNER")) return { ok: false, error: "notOwner" };
  if (!request.repeatable && request.rolls.length) return { ok: false, error: "alreadyRolled" };

  const roll = new foundry.dice.Roll(request.formula, actor.getRollData());
  await roll.evaluate();
  const entry = { total: roll.total as number, by: user.name, at: new Date().toISOString() };
  const write = async (next: HealRequest) =>
    message.update({ content: await cardHtml(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
  await write({ ...request, rolls: [...request.rolls, entry] });
  try {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: localize("Abilities.Heal.Flavor", { ability: request.ability, healer: request.healerName }),
    });
    await applyHealing(actor, entry.total);
  } catch (err) {
    await write(request); // nothing was applied: let the card be rolled again
    throw err;
  }
  return { ok: true, total: entry.total };
}

export function registerHealPrompt(apply: ApplyHealing): void {
  applyHealing = apply;
  // Any player may receive the pop-up; the handler only opens a dialog.
  registerClientQuery("heal.prompt", (data) => {
    const messageId = typeof data === "object" && data && "messageId" in data ? data.messageId : null;
    if (typeof messageId === "string") void promptRoll(messageId);
    return { ok: true };
  });
  // Players can't edit a card or heal an actor they don't control, so the GM does both.
  registerQuery("heal.roll", serialize(healRoll), { access: "player" });
  Hooks.on("renderChatMessageHTML", (message: { id: string; getFlag(scope: string, key: string): unknown }, html: HTMLElement) => {
    const request = requestOf(message);
    const button = html.querySelector<HTMLButtonElement>("[data-action='tl-heal-roll']");
    if (!request || !button) return;
    const target: HealActor | null = fromUuidSync(request.targetUuid);
    if (!target?.isOwner) {
      button.remove();
      return;
    }
    button.addEventListener("click", () => void rollHealing(message.id));
  });
}
