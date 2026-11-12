import { MODULE_ID, localize, template } from "../constants";
import { askGM } from "../queries";
import { buildClockView } from "./format";
import { applyManualEdit, manualInputFrom, type ManualCalendarInput, type ManualStormInput } from "./manual";
import type { CalendarSnapshot } from "./snapshot";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const SETTING_CALENDAR = "calendar";
export const SETTING_STALE_DAYS = "calendarStaleDays";
export const SETTING_WIDGET = "clockWidget";

const getCalendar = (): CalendarSnapshot | null => game.settings.get(MODULE_ID, SETTING_CALENDAR) ?? null;

function openEditForm() {
  new ClockEditForm().render({ force: true });
}

/** Floating world-clock widget, visible to everyone. Closing it turns the per-client setting off. */
export class ClockWidget extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tl-clock-widget",
    classes: ["tl-clock"],
    window: { title: "TABLE_LEDGER.Clock.Title", icon: "fa-solid fa-cloud-bolt", minimizable: true, resizable: false },
    position: { width: 280, height: "auto", top: 80, left: 120 },
    actions: { edit: openEditForm },
  };

  static PARTS = { body: { template: template("clock/widget.hbs"), scrollable: [""] } };

  async _prepareContext() {
    return {
      ...buildClockView(getCalendar(), {
        now: new Date(),
        staleDays: Number(game.settings.get(MODULE_ID, SETTING_STALE_DAYS)),
        t: localize,
      }),
      isGM: game.user.isGM,
    };
  }

  _onClose(options: unknown) {
    super._onClose(options);
    if (game.settings.get(MODULE_ID, SETTING_WIDGET)) game.settings.set(MODULE_ID, SETTING_WIDGET, false);
  }
}

/** GM-only manual entry, so the clock works without the planner push. */
export class ClockEditForm extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tl-clock-edit",
    tag: "form",
    classes: ["tl-clock-edit"],
    window: { title: "TABLE_LEDGER.Clock.Edit.Title", icon: "fa-solid fa-pen" },
    position: { width: 400, height: "auto" },
    form: { handler: submitEdit, closeOnSubmit: true },
  };

  static PARTS = { form: { template: template("clock/edit.hbs") } };

  async _prepareContext() {
    return {
      input: manualInputFrom(getCalendar()),
      stormlightChoices: {
        "": localize("Clock.Edit.Unknown"),
        true: localize("Clock.Stormlight.Available"),
        false: localize("Clock.Stormlight.Unavailable"),
      },
      intensityChoices: {
        "": localize("Clock.Intensity.unknown"),
        weak: localize("Clock.Intensity.weak"),
        normal: localize("Clock.Intensity.normal"),
        mighty: localize("Clock.Intensity.mighty"),
      },
    };
  }
}

function stormInput(o: Record<string, unknown> | undefined): ManualStormInput {
  const text = (k: string) => (typeof o?.[k] === "string" ? (o[k] as string) : "");
  const rawInDays = o?.next_in_days;
  return {
    next_date: text("next_date"),
    next_in_days: typeof rawInDays === "number" && Number.isFinite(rawInDays) ? Math.trunc(rawInDays) : null,
    next_confidence: text("next_confidence"),
    last_date: text("last_date"),
    last_intensity: text("last_intensity"),
    last_notes: text("last_notes"),
  };
}

async function submitEdit(_event: Event, _form: HTMLFormElement, formData: { object: Record<string, unknown> }) {
  // Field names are dotted ("highstorm.next_date"); expand into nested objects.
  const o: Record<string, unknown> = foundry.utils.expandObject(formData.object);
  const text = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const storm = (k: string) => (o[k] && typeof o[k] === "object" ? (o[k] as Record<string, unknown>) : undefined);
  const input: ManualCalendarInput = {
    vorin_date: text("vorin_date"),
    time_of_day: text("time_of_day"),
    stormlight: (["", "true", "false"].includes(String(o.stormlight ?? "")) ? String(o.stormlight ?? "") : "") as ManualCalendarInput["stormlight"],
    highstorm: stormInput(storm("highstorm")),
    everstorm: stormInput(storm("everstorm")),
  };
  const result = applyManualEdit(getCalendar(), input, new Date().toISOString());
  if (!result.ok) {
    ui.notifications.error(localize("Clock.Edit.Invalid", { error: result.error }));
    throw new Error(result.error);
  }
  await askGM("setCalendar", result.value);
  ui.notifications.info(localize("Clock.Edit.Saved"));
}
