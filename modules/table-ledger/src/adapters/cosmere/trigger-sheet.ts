import { MODULE_ID, localize, template } from "../../constants";
import {
  COSTS,
  EFFECTS,
  KINDS,
  LIMITS,
  NOTE_LIMIT,
  OUTCOMES,
  TAG_FLAG,
  parseTag,
  type TriggerRule,
} from "../../abilities/triggers";
import { BUILT_IN_RULES } from "./trigger-rules";

const SHEET_TYPES: Record<string, true> = { talent: true, action: true, power: true };

interface SheetItem {
  id: string;
  uuid: string;
  name: string;
  type: string;
  actor?: { items: Iterable<{ id: string; name: string; type: string; system?: { id?: string } }> } | null;
  system?: { id?: string };
  getFlag(scope: string, key: string): unknown;
  update(data: Record<string, unknown>): Promise<unknown>;
  unsetFlag(scope: string, key: string): Promise<unknown>;
}

interface SheetApp {
  document?: SheetItem & { documentName?: string };
  isEditable?: boolean;
  element?: HTMLElement;
}

const choices = (values: readonly string[], group: string, current: string) =>
  values.map((value) => ({ value, label: localize(`Triggers.Editor.${group}.${value}`), selected: value === current }));

/** Items with a system id the tag can name as its follow-up, on the item's own actor. */
function followUpChoices(item: SheetItem, current: string) {
  const items = item.actor ? [...item.actor.items] : [];
  const out = items
    .filter((other) => other.system?.id && ["talent", "action", "power"].includes(other.type))
    .map((other) => ({ value: other.system!.id!, label: other.name, selected: other.system!.id === current }));
  if (current && !out.some((o) => o.selected)) out.push({ value: current, label: current, selected: true });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function builtInSummary(item: SheetItem): string {
  const rules = (item.system?.id && BUILT_IN_RULES[item.system.id]) || [];
  return rules.map((rule) => `${localize(`Triggers.Editor.Kind.${rule.trigger.kind}`)} → ${localize(`Triggers.Editor.Effect.${rule.effect}`)}`).join("; ");
}

const open = new Set<string>();
/** Latest mount per sheet, so a slower earlier render can't add a second editor. */
const mounts = new WeakMap<HTMLElement, number>();

/** Render from `draft` (fields being edited, possibly invalid) or else from the saved tag. */
async function editorHtml(item: SheetItem, editable: boolean, invalid?: string, draft?: Partial<TriggerRule>): Promise<string> {
  const stored = item.getFlag(MODULE_ID, TAG_FLAG);
  const saved = stored && typeof stored === "object" ? (stored as Partial<TriggerRule>) : undefined;
  const tag = draft ?? saved;
  const current = {
    kind: tag?.trigger?.kind ?? "weapon-attack",
    actionId: tag?.trigger?.actionId ?? "",
    outcome: tag?.outcome ?? "any",
    effect: tag?.effect ?? "follow-up",
    followUp: tag?.followUp ?? "",
    cost: tag?.cost ?? "normal",
    limit: tag?.limit ?? "none",
    optional: tag?.optional !== false,
    note: tag?.note ?? "",
    amount: tag?.amount ?? 0,
  };
  return foundry.applications.handlebars.renderTemplate(template("abilities/trigger-tag.hbs"), {
    editable,
    open: open.has(item.uuid),
    hasTag: !!saved,
    builtIn: saved ? "" : builtInSummary(item),
    invalid,
    noteLimit: NOTE_LIMIT,
    ...current,
    kinds: choices(KINDS, "Kind", current.kind),
    outcomes: choices(OUTCOMES, "Outcome", current.outcome),
    effects: choices(EFFECTS, "Effect", current.effect),
    costs: choices(COSTS, "Cost", current.cost),
    limits: choices(LIMITS, "Limit", current.limit),
    followUps: followUpChoices(item, current.followUp),
    showAction: current.kind === "action",
    showFollowUp: current.effect === "follow-up" || current.effect === "replacement-heal",
    showAmount: current.effect === "focus-spend",
  });
}

function readFields(root: HTMLElement, item: SheetItem): Record<string, unknown> {
  const value = (field: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`)?.value ?? "";
  const kind = value("kind");
  const amount = value("amount");
  return {
    id: `tag-${item.id}`,
    name: item.name,
    trigger: { kind, ...(kind === "action" ? { actionId: value("actionId") } : {}) },
    outcome: value("outcome"),
    effect: value("effect"),
    followUp: value("followUp"),
    cost: value("cost"),
    limit: value("limit"),
    optional: root.querySelector<HTMLInputElement>('[data-field="optional"]')?.checked ?? true,
    note: value("note"),
    ...(amount !== "" ? { amount: Number(amount) } : {}),
  };
}

async function mount(root: HTMLElement, item: SheetItem, editable: boolean, invalid?: string, draft?: Partial<TriggerRule>): Promise<void> {
  const seq = (mounts.get(root) ?? 0) + 1;
  mounts.set(root, seq);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = await editorHtml(item, editable, invalid, draft);
  if (mounts.get(root) !== seq) return;
  root.querySelector(".tl-trigger-editor")?.remove();
  const host = root.querySelector<HTMLElement>('.tab-content[data-tab="details"]') ?? root.querySelector<HTMLElement>(".window-content");
  const editor = wrapper.querySelector<HTMLElement>(".tl-trigger-editor");
  if (!host || !editor) return;
  host.append(editor);
  editor.addEventListener("toggle", () => (editor.hasAttribute("open") ? open.add(item.uuid) : open.delete(item.uuid)));
  if (!editable) return;
  // Each change re-renders from the fields as entered, so fields that depend on the trigger or
  // effect appear and a tag that is invalid half-way can still be finished; only a valid tag is saved.
  editor.addEventListener("change", (event) => {
    event.stopPropagation();
    const fields = readFields(editor, item);
    const parsed = parseTag(fields);
    if (!parsed.ok) {
      void mount(root, item, editable, localize("Triggers.Editor.Invalid", { reason: parsed.reason }), fields as Partial<TriggerRule>);
      return;
    }
    // `==` replaces the stored tag; setFlag would merge and keep fields from an earlier trigger or effect.
    void item.update({ [`flags.${MODULE_ID}.==${TAG_FLAG}`]: fields }).then(() => mount(root, item, editable));
  });
  editor.querySelector("[data-action='tl-trigger-clear']")?.addEventListener("click", (event) => {
    event.preventDefault();
    void item.unsetFlag(MODULE_ID, TAG_FLAG).then(() => mount(root, item, editable));
  });
}

/** Add the editor to a talent, action or power sheet, and keep it after the sheet re-draws its tabs. */
export function onRenderItemSheet(app: SheetApp, html: HTMLElement): void {
  const item = app.document;
  const root = app.element ?? html;
  if (item?.documentName !== "Item" || !SHEET_TYPES[item.type] || root.dataset.tlTrigger) return;
  root.dataset.tlTrigger = "1";
  const editable = app.isEditable === true;
  let mounting = false;
  const ensure = () => {
    if (mounting || root.querySelector(".tl-trigger-editor")) return;
    mounting = true;
    void mount(root, item, editable).finally(() => {
      mounting = false;
    });
  };
  new MutationObserver(ensure).observe(root, { childList: true, subtree: true });
  ensure();
}
