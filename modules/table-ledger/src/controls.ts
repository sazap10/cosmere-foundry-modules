import { MODULE_ID } from "./constants";

export interface LedgerTool {
  name: string;
  title: string;
  icon: string;
  gmOnly?: boolean;
  /** Hidden from GMs (e.g. a player's own view). */
  playerOnly?: boolean;
  onClick: () => void;
}

interface SceneControlTool {
  name: string;
  order: number;
  [key: string]: unknown;
}

const tools: LedgerTool[] = [];
let hooked = false;

/**
 * Add a button to the Token Controls group (v13 record-style controls). Call
 * during `init`.
 *
 * Not a group of our own: v13 fires a group's active tool when the group is
 * opened and ignores clicks on the already-active tool, so a group made only
 * of buttons opens its first window by itself and that button then does
 * nothing. A group without a canvas layer also stops token selection.
 */
export function registerTool(tool: LedgerTool) {
  tools.push(tool);
  if (hooked) return;
  hooked = true;
  Hooks.on("getSceneControlButtons", (controls: Record<string, { tools: Record<string, SceneControlTool> } | undefined>) => {
    const group = controls.tokens;
    if (!group) return;
    let order = Math.max(0, ...Object.values(group.tools).map((t) => t.order ?? 0));
    for (const t of tools) {
      if ((t.gmOnly && !game.user.isGM) || (t.playerOnly && game.user.isGM)) continue;
      const name = `${MODULE_ID}-${t.name}`;
      group.tools[name] = { name, title: t.title, icon: t.icon, order: ++order, button: true, visible: true, onChange: () => t.onClick() };
    }
  });
}
