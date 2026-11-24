import { MODULE_ID } from "../constants";
import { registerTool } from "../controls";
import { registerQuery } from "../queries";
import { validateCalendar } from "./snapshot";
import { ClockWidget, SETTING_CALENDAR, SETTING_STALE_DAYS, SETTING_WIDGET } from "./widget";
import { toSimpleCalendarDate, type SimpleCalendarDate } from "./simple-calendar";

/** The slice of Simple Calendar's public API (`SimpleCalendar.api`) used here. */
interface SimpleCalendarApi {
  getCurrentCalendar(): { months?: { numberOfDays: number }[]; weekdays?: unknown[] } | null;
  setDate(date: SimpleCalendarDate): boolean;
}

function simpleCalendarApi(): SimpleCalendarApi | null {
  const sc: unknown = Reflect.get(globalThis, "SimpleCalendar");
  if (!sc || typeof sc !== "object" || !("api" in sc)) return null;
  const api = sc.api;
  if (!api || typeof api !== "object" || !("setDate" in api) || !("getCurrentCalendar" in api)) return null;
  // Shape checked above; Simple Calendar publishes no types.
  return api as SimpleCalendarApi;
}

/**
 * Mirror the planner's date into Simple Calendar when it's active, so players
 * see one date. Runs on the GM client (setCalendar is GM-only).
 */
function syncSimpleCalendar(current: { vorin_date: string; time_of_day: string | null }): string {
  const api = simpleCalendarApi();
  if (!api) return "absent";
  const calendar = api.getCurrentCalendar();
  const monthLengths = (calendar?.months ?? []).map((m) => m.numberOfDays);
  const daysPerWeek = calendar?.weekdays?.length ?? 0;
  if (!monthLengths.length || !daysPerWeek) return "skipped: no calendar";
  const date = toSimpleCalendarDate(current.vorin_date, current.time_of_day, { daysPerWeek, monthLengths });
  if (!date) return `skipped: ${current.vorin_date} doesn't fit the Simple Calendar calendar`;
  return api.setDate(date) ? "synced" : "skipped: setDate refused";
}

let widget: InstanceType<typeof ClockWidget> | null = null;

function refresh() {
  if (widget?.rendered) widget.render();
}

function setWidgetVisible(visible: boolean) {
  widget ??= new ClockWidget();
  if (visible && !widget.rendered) widget.render({ force: true });
  else if (!visible && widget.rendered) widget.close();
}

export function init() {
  game.settings.register(MODULE_ID, SETTING_CALENDAR, {
    scope: "world",
    config: false,
    type: Object,
    default: null,
    onChange: refresh,
  });
  game.settings.register(MODULE_ID, SETTING_STALE_DAYS, {
    name: "TABLE_LEDGER.Clock.Settings.StaleDays.Name",
    hint: "TABLE_LEDGER.Clock.Settings.StaleDays.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 14,
    onChange: refresh,
  });
  game.settings.register(MODULE_ID, SETTING_WIDGET, {
    name: "TABLE_LEDGER.Clock.Settings.Widget.Name",
    hint: "TABLE_LEDGER.Clock.Settings.Widget.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (value: boolean) => setWidgetVisible(value),
  });

  registerQuery("setCalendar", async (data) => {
    const result = validateCalendar(data);
    if (!result.ok) throw new Error(`${MODULE_ID}.setCalendar: ${result.error}`);
    await game.settings.set(MODULE_ID, SETTING_CALENDAR, result.value);
    return { ok: true, simpleCalendar: syncSimpleCalendar(result.value.current) };
  }, { external: true });

  registerTool({
    name: "clock",
    // Scene-control titles are localized by core; i18n isn't ready during init.
    title: "TABLE_LEDGER.Clock.Tool",
    icon: "fa-solid fa-cloud-bolt",
    onClick: () => game.settings.set(MODULE_ID, SETTING_WIDGET, !game.settings.get(MODULE_ID, SETTING_WIDGET)),
  });
}

export function ready() {
  if (game.settings.get(MODULE_ID, SETTING_WIDGET)) setWidgetVisible(true);
}
