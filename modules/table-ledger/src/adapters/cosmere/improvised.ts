// An "Improvised Strike" common action on every character. Using it asks which
// Light or Heavy weapon the improvised object stands in for (the rule: match the
// most fitting weapon), then makes that weapon's Strike with a throwaway action
// that is never stored on the actor.
import { MODULE_ID, localize } from "../../constants";

const SYSTEM_ID = "cosmere-rpg";
const SETTING = "improvisedStrike";
const ACTION_ID = "improvised-strike";
const ENTRY_FLAG = "improvised";
const STRIKE_IMG = "icons/skills/melee/hand-grip-sword-strike-orange.webp";

interface WeaponDoc {
  name: string;
  type: string;
  img?: string;
  system: {
    type?: string;
    strike?: { die?: { count?: number; size?: string }; damageBonus?: string; damageType?: string };
    traits?: { loaded?: { active?: boolean } };
    attack?: { type?: string };
  };
  getWeaponStrikeData(): { system: Record<string, unknown> }[];
}

interface ImprovisedItem {
  type: string;
  actor?: ActorDoc | null;
  constructor: new (data: Record<string, unknown>, options: { parent: ActorDoc }) => { use(options?: Record<string, unknown>): Promise<unknown> };
  getFlag(scope: string, key: string): unknown;
}

interface ActorDoc {
  type: string;
  items: Iterable<{ system?: { id?: string } }>;
  createEmbeddedDocuments(type: "Item", data: Record<string, unknown>[]): Promise<unknown>;
}

export interface WeaponOption {
  key: string;
  light: boolean;
  label: string;
  doc: WeaponDoc;
}

let optionsCache: Promise<WeaponOption[]> | undefined;

const dieOf = (weapon: WeaponDoc): string => {
  const strike = weapon.system.strike;
  return [`${strike?.die?.count ?? 1}${strike?.die?.size ?? ""}`, strike?.damageBonus].filter(Boolean).join(" + ");
};

/** Light and Heavy melee-style weapons from the system's items compendium, one per name, damage and type. */
export function weaponOptions(): Promise<WeaponOption[]> {
  optionsCache ??= (async () => {
    const pack = game.packs.get(`${SYSTEM_ID}.items`);
    if (!pack) return [];
    const docs: WeaponDoc[] = await pack.getDocuments({ type: "weapon" });
    const seen: Record<string, WeaponOption> = {};
    for (const doc of docs) {
      const type = doc.system.type;
      const melee = doc.system.attack?.type !== "ranged" && !doc.system.traits?.loaded?.active;
      if ((type !== "light_wpn" && type !== "heavy_wpn") || !doc.system.strike?.die?.size || !melee) continue;
      const light = type === "light_wpn";
      const label = `${doc.name} (${dieOf(doc)} ${doc.system.strike.damageType ?? ""})`.replace(/\s+\)/, ")");
      const key = `${light}|${label}`;
      seen[key] ??= { key, light, label, doc };
    }
    return Object.values(seen).sort((a, b) => Number(b.light) - Number(a.light) || a.label.localeCompare(b.label));
  })();
  return optionsCache;
}

async function chooseWeapon(options: WeaponOption[]): Promise<WeaponOption | null> {
  const group = (light: boolean) =>
    `<optgroup label="${localize(light ? "Improvised.Light" : "Improvised.Heavy")}">${options
      .filter((o) => o.light === light)
      .map((o) => `<option value="${foundry.utils.escapeHTML(o.key)}">${foundry.utils.escapeHTML(o.label)}</option>`)
      .join("")}</optgroup>`;
  const key: string | null = await foundry.applications.api.DialogV2.prompt({
    window: { title: localize("Improvised.Title") },
    content: `<p>${localize("Improvised.Choose")}</p><div class="form-group"><select name="weapon" autofocus>${group(true)}${group(false)}</select></div>`,
    ok: { label: localize("Improvised.Strike"), callback: (_event: unknown, button: { form: { elements: { weapon: { value: string } } } }) => button.form.elements.weapon.value },
    rejectClose: false,
  });
  return options.find((o) => o.key === key) ?? null;
}

async function strikeWith(item: ImprovisedItem): Promise<void> {
  const actor = item.actor;
  if (!actor) return;
  const options = await weaponOptions();
  if (!options.length) {
    ui.notifications.warn(localize("Improvised.NoWeapons"));
    return;
  }
  const chosen = await chooseWeapon(options);
  if (!chosen) return;
  const [data] = chosen.doc.getWeaponStrikeData();
  const strike = new item.constructor(
    {
      ...data,
      name: localize("Improvised.StrikeName", { weapon: chosen.doc.name }),
      system: { ...data.system, id: "strike-improvised", description: { value: `<p>${localize("Improvised.Description", { weapon: chosen.doc.name })}</p>` } },
    },
    { parent: actor },
  );
  await strike.use();
}

/** Replace the action's use with the weapon choice; with the setting off, refuse it rather than letting the bare action post a card. */
function onPreUseItem(item: ImprovisedItem | undefined): false | void {
  if (item?.type !== "action" || !item.getFlag(MODULE_ID, ENTRY_FLAG)) return;
  if (!enabled()) {
    ui.notifications.warn(localize("Improvised.Disabled"));
    return false;
  }
  void strikeWith(item).catch((err: unknown) => ui.notifications.error(err instanceof Error ? err.message : String(err)));
  return false;
}

const actionData = () => ({
  type: "action",
  name: localize("Improvised.Name"),
  img: STRIKE_IMG,
  system: {
    id: ACTION_ID,
    activation: { type: "utility", cost: { value: 1, type: "act" } },
    description: { value: `<p>${localize("Improvised.ActionDescription")}</p>` },
  },
  flags: { [MODULE_ID]: { [ENTRY_FLAG]: true } },
});

const enabled = (): boolean => game.settings.get(MODULE_ID, SETTING) === true;

async function ensureAction(actor: ActorDoc): Promise<void> {
  if (actor.type !== "character" || [...actor.items].some((i) => i.system?.id === ACTION_ID)) return;
  await actor.createEmbeddedDocuments("Item", [actionData()]);
}

/** Registers the setting and hooks. Call from `init`. */
export function registerImprovisedStrike(): void {
  game.settings.register(MODULE_ID, SETTING, {
    name: "TABLE_LEDGER.Improvised.Settings.Name",
    hint: "TABLE_LEDGER.Improvised.Settings.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  Hooks.on(`${SYSTEM_ID}.preUseItem`, onPreUseItem);
  Hooks.on("createActor", (actor: ActorDoc) => {
    if (enabled() && game.user.isActiveGM) void ensureAction(actor);
  });
}

/** Gives every existing character the action. Call from `ready`; only the active GM writes. */
export async function ensureImprovisedActions(): Promise<void> {
  if (!enabled() || !game.user.isActiveGM) return;
  for (const actor of game.actors.contents as ActorDoc[]) await ensureAction(actor);
}
