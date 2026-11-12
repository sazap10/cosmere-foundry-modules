import type { GoalsAdapter } from "../adapters/types";
import { clampLevel, stepLevel } from "./model";

/**
 * Pip click shared by the board and the widget: left-click +1, right-click -1.
 * Keyboard (Enter/Space on the focused button) adds 1; hold Shift to remove 1.
 * Writes go straight through the item (the user owns it), so the system's goal hooks fire.
 */
export async function changeGoalLevel(adapter: GoalsAdapter, event: PointerEvent, target: HTMLElement) {
  const { itemUuid, level, max } = target.dataset;
  if (!itemUuid) return;
  const goal = { level: Number(level), max: Number(max) };
  const next = stepLevel(goal, event.button === 2 || event.shiftKey ? -1 : 1);
  if (next === clampLevel(goal.level, goal.max)) return;
  try {
    await adapter.setLevel(itemUuid, next);
  } catch (err) {
    ui.notifications.error(err instanceof Error ? err.message : String(err));
  }
}

export function openActorSheet(target: HTMLElement) {
  const uuid = target.dataset.actorUuid;
  if (uuid) fromUuidSync(uuid)?.sheet?.render(true);
}
