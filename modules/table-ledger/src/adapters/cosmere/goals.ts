import type { CharacterGoals, GoalView, GoalsAdapter } from "../types";
import { clampLevel } from "../../goals/model";
import { partyActors } from "../../party";

// cosmere-rpg 3.1.2: goal items are `type: "goal"` with `system.level` (NumberField 0..3,
// src/system/data/item/goal.ts). Character purpose/obstacle are HTMLFields
// (src/system/data/actor/character.ts). `completeGoal` is called via Hooks.callAll with
// the item after an updateItem that reaches max level (src/system/hooks/item.ts).
const GOAL_TYPE = "goal";
const CHARACTER_TYPE = "character";
const COMPLETE_HOOK = "cosmere-rpg.completeGoal";
const DEFAULT_MAX = 3;

/** The slice of a cosmere-rpg goal Item this adapter reads. */
interface GoalItem {
  type: typeof GOAL_TYPE;
  uuid: string;
  name: string;
  sort?: number;
  parent: unknown;
  system: { level: number; description?: { value?: string } };
  update(data: Record<string, unknown>): Promise<unknown>;
}

/** The slice of a cosmere-rpg character Actor this adapter reads. */
interface CharacterActor {
  documentName: "Actor";
  type: typeof CHARACTER_TYPE;
  uuid: string;
  name: string;
  img?: string;
  id: string;
  hasPlayerOwner: boolean;
  items: { contents: unknown[] };
  system: { purpose?: string; obstacle?: string };
}

function isGoal(item: unknown): item is GoalItem {
  return typeof item === "object" && item !== null && "type" in item && item.type === GOAL_TYPE;
}

function isCharacter(actor: unknown): actor is CharacterActor {
  return (
    typeof actor === "object" &&
    actor !== null &&
    "documentName" in actor &&
    actor.documentName === "Actor" &&
    "type" in actor &&
    actor.type === CHARACTER_TYPE
  );
}

function goalMax(): number {
  const level = CONFIG.Item?.dataModels?.[GOAL_TYPE]?.schema?.fields?.level;
  const max: unknown = level?.max ?? level?.options?.max;
  return typeof max === "number" && max > 0 ? max : DEFAULT_MAX;
}

/** Plain text from system HTML. DOMParser builds an inert document, so nothing loads or runs. */
function htmlToText(html: unknown): string | undefined {
  if (typeof html !== "string" || !html.trim()) return undefined;
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function toCharacterGoals(actor: CharacterActor): CharacterGoals {
  const max = goalMax();
  const goals: GoalView[] = actor.items.contents
    .filter(isGoal)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((item) => ({
      itemUuid: item.uuid,
      name: item.name,
      level: clampLevel(Number(item.system.level ?? 0), max),
      max,
      description: htmlToText(item.system.description?.value),
    }));
  return {
    actorUuid: actor.uuid,
    actorName: actor.name,
    img: actor.img,
    purpose: htmlToText(actor.system.purpose),
    obstacle: htmlToText(actor.system.obstacle),
    goals,
  };
}

export const cosmereGoals: GoalsAdapter = {
  listCharacters() {
    return partyActors<CharacterActor>(isCharacter).map(toCharacterGoals);
  },

  forActor(actor) {
    return isCharacter(actor) ? toCharacterGoals(actor) : null;
  },

  async setLevel(itemUuid, level) {
    const item: unknown = await fromUuid(itemUuid);
    if (!isGoal(item)) throw new Error(`Not a goal item: ${itemUuid}`);
    const next = clampLevel(level, goalMax());
    if (next === item.system.level) return;
    await item.update({ "system.level": next });
  },

  onChange(callback) {
    const onItem = (item: unknown) => {
      if (isGoal(item) && isCharacter(item.parent)) callback();
    };
    const onActor = (actor: unknown) => {
      if (isCharacter(actor)) callback();
    };
    for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, onItem);
    for (const hook of ["createActor", "updateActor", "deleteActor"]) Hooks.on(hook, onActor);
    // Character assignment lives on the User.
    Hooks.on("updateUser", (_user: unknown, change: Record<string, unknown>) => {
      if ("character" in change) callback();
    });
  },

  onComplete(callback) {
    Hooks.on(COMPLETE_HOOK, (item: unknown) => callback(item));
  },
};
