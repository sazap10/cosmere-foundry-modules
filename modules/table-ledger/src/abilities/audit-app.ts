import { localize, template } from "../constants";
import type { AbilityAdapter, AbilityFix, AbilityRecord } from "../adapters/types";
import { auditAction, buildReport, type AuditEntry } from "./audit-rules";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

interface AuditRow extends AuditEntry {
  ref: unknown;
}

interface SheetOwner {
  sheet?: { render(options: { force: boolean }): unknown } | null;
}

/** GM window listing actions whose data contradicts their description. */
class AbilityAuditApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tl-abilities-audit",
    classes: ["tl-abilities-audit"],
    window: { title: "TABLE_LEDGER.Abilities.Audit.Title", icon: "fa-solid fa-stethoscope", resizable: true },
    position: { width: 760, height: 620 },
    actions: {
      open: AbilityAuditApp.#onOpen,
      fix: AbilityAuditApp.#onFix,
      rescan: AbilityAuditApp.#onRescan,
      copyReport: AbilityAuditApp.#onCopyReport,
    },
  };

  static PARTS = {
    body: { template: template("abilities/audit.hbs"), scrollable: ["", ".tl-abilities-list"] },
  };

  readonly #adapter: AbilityAdapter;
  #rows: AuditRow[] = [];
  #scanned = 0;

  constructor(adapter: AbilityAdapter, options: Record<string, unknown> = {}) {
    super(options);
    this.#adapter = adapter;
  }

  async _prepareContext() {
    const records = this.#adapter.scan();
    this.#scanned = records.length;
    this.#rows = records.flatMap((record: AbilityRecord) => {
      const findings = auditAction(record);
      if (!findings.length) return [];
      return [
        {
          ref: record.ref,
          uuid: record.uuid,
          name: record.name,
          location: record.location,
          activationType: record.activationType,
          damageFormula: record.damageFormula,
          damageType: record.damageType,
          findings,
        },
      ];
    });
    return {
      scanned: this.#scanned,
      findingCount: this.#rows.reduce((n, row) => n + row.findings.length, 0),
      rows: this.#rows.map((row, index) => ({
        index,
        name: row.name,
        location: row.location,
        activation: localize(`Abilities.Activation.${row.activationType}`),
        damage: row.damageFormula ? `${row.damageFormula}${row.damageType ? ` (${row.damageType})` : ""}` : null,
        findings: row.findings.map((finding) => ({
          text: localize(`Abilities.Reason.${finding.reason}`),
          fixes: finding.fixes.map((fix) => ({ fix, label: localize(`Abilities.Fix.${fix}`) })),
        })),
      })),
    };
  }

  #row(target: HTMLElement): AuditRow | undefined {
    return this.#rows[Number(target.closest<HTMLElement>("[data-index]")?.dataset.index)];
  }

  static #onOpen(this: AbilityAuditApp, _event: Event, target: HTMLElement) {
    (this.#row(target)?.ref as SheetOwner | undefined)?.sheet?.render({ force: true });
  }

  static async #onFix(this: AbilityAuditApp, _event: Event, target: HTMLElement) {
    const row = this.#row(target);
    const fix = target.dataset.fix as AbilityFix | undefined;
    if (!row || !fix) return;
    const escape = foundry.utils.escapeHTML;
    const confirmed = await DialogV2.confirm({
      window: { title: localize("Abilities.Audit.ConfirmTitle") },
      content: `<p>${localize("Abilities.Audit.ConfirmContent", {
        name: escape(row.name),
        location: escape(row.location),
        fix: localize(`Abilities.Fix.${fix}`),
      })}</p>`,
      rejectClose: false,
    });
    if (!confirmed) return;
    await this.#adapter.applyFix(row.ref, fix);
    ui.notifications.info(localize("Abilities.Audit.Fixed", { name: row.name }));
    await this.render();
  }

  static async #onRescan(this: AbilityAuditApp) {
    await this.render();
  }

  static async #onCopyReport(this: AbilityAuditApp) {
    const report = buildReport(this.#rows, {
      system: `${game.system.id} ${game.system.version}`,
      foundry: game.version,
    });
    await game.clipboard.copyPlainText(report);
    ui.notifications.info(localize("Abilities.Audit.Copied"));
  }
}

let app: AbilityAuditApp | null = null;

export function openAbilityAudit(adapter: AbilityAdapter) {
  app ??= new AbilityAuditApp(adapter);
  void app.render({ force: true });
}
