import { template } from "../constants";
import { SETTINGS, getSetting } from "./settings";

/** Post a chat card for a completed goal. Call on every client; only the active GM posts. */
export async function announceCompletion(item: unknown) {
  if (!game.user.isActiveGM || !getSetting(SETTINGS.announceComplete)) return;
  if (typeof item !== "object" || item === null || !("name" in item) || !("parent" in item)) return;
  const actor = item.parent;
  if (typeof actor !== "object" || actor === null || !("name" in actor)) return;
  const content = await foundry.applications.handlebars.renderTemplate(template("goals/complete-card.hbs"), {
    actorName: actor.name,
    goalName: item.name,
    img: "img" in actor ? actor.img : undefined,
  });
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });
}
