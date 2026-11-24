# Table Ledger

Foundry VTT v13 module for running a table: endeavour tracker, goals board, world clock, session recaps, a target picker with target-rolled heals, and an ability data audit.

System support goes through adapters (`src/adapters/`):

| Feature | Cosmere RPG | Other systems |
|---|---|---|
| Endeavour tracker | ✔ | ✔ (system-neutral) |
| World clock | ✔ | ✔ (shows whatever the planner pushes; mirrors the date into Simple Calendar when active) |
| Session recaps | ✔ | ✔ |
| Goals board / My goals | ✔ (goal items, 0–3 pips) | needs an adapter |
| Target picker (before focus/Investiture is spent; skipped for weapon Strikes unless enabled in settings) | ✔ | needs an adapter |
| Target-rolled heals (Field Medicine, Progression's Regrowth) | ✔ | needs an adapter |
| Ability audit + chat hints (includes items whose charges no action spends, with a one-click fix) | ✔ | needs an adapter |
| Charges/uses/ammo shown on actor-sheet item rows | ✔ | needs an adapter |

## Install

Manifest URL: `https://raw.githubusercontent.com/sazap10/cosmere-foundry-modules/main/modules/table-ledger/module.json`

## Develop

```bash
npm install         # from the repo root (npm workspaces)
npm test -w modules/table-ledger            # vitest, pure logic
npm run typecheck -w modules/table-ledger
npm run build -w modules/table-ledger       # → modules/table-ledger/build/table-ledger (copy into <FoundryData>/Data/modules/)
```

## Planner integration

The cosmere-rpg-planner pushes calendar snapshots and recaps through the foundry-mcp `call-module-query` tool, which calls this module's GM-only queries:

- `table-ledger.setCalendar` — calendar snapshot (see `src/clock/snapshot.ts`); also sets Simple Calendar's date when that module is active, and reports `simpleCalendar: "synced" | "absent" | "skipped: …"`
- `table-ledger.postRecap` — `{ session, date?, title, html }` → "Session Recaps" journal page + chat card

Both also have manual GM forms in the Table Ledger scene controls.
