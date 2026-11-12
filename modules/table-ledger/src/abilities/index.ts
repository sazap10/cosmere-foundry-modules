import { registerTool } from "../controls";
import type { AbilityAdapter } from "../adapters/types";
import { openAbilityAudit } from "./audit-app";

let active: AbilityAdapter | null = null;

export function init(adapter: AbilityAdapter) {
  active = adapter;
  adapter.register();
  registerTool({
    name: "ability-audit",
    // Scene-control titles are localized by core; i18n isn't ready during init.
    title: "TABLE_LEDGER.Abilities.Audit.Title",
    icon: "fa-solid fa-stethoscope",
    gmOnly: true,
    onClick: () => openAbilityAudit(adapter),
  });
}

export function ready() {
  active?.ready();
}
