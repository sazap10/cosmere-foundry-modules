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
| Optional ability triggers (popup + chat card after an action; once-per-round limits) | ✔ | needs an adapter |
| Improvised Strike action (pick the Light or Heavy weapon it stands in for) | ✔ | needs an adapter |

## Ability triggers (Cosmere RPG)

After a character uses an action, the module offers the talents that trigger on it. A popup opens for the user who used the action, and a chat card with the same buttons stays in the log until the combat round ends (outside combat it never expires). Taking an offer uses the follow-up with its cost rule: Combat Coordination's Decisive Command costs no focus after a missed Strike, Binding Strike leaves the cost to the system's consume dialog, and Shadowing spends its 3 focus. Combat Training's graze is applied through the GM, who rolls the weapon's graze dice and grazes each card once. A once-per-round talent is offered again only after the next combat round starts.

Built-in rules cover Combat Coordination, Practical Demonstration, Combat Training, Binding Strike, Swift Healer, Swift Regeneration and Shadowing. Other talents, homebrew included, get a trigger from the **Ability trigger** section on the item's Details tab; a trigger set there replaces the item's built-in one. Anyone who can edit an item can edit its trigger.

Limits:

- Swift Healer's extra health is added to heals rolled by the module's heal prompt (Field Medicine, Regrowth). Heals applied with the system's own Apply buttons get no bonus, because the system doesn't say who healed.
- Only once per round is tracked. Once per scene or day, and uses made by hand, are not.
- Plot-die talents (Opportunist, Sure Outcome) and reactions to other characters (Reactive Strike) are not covered.

The world setting **Offer ability triggers** turns the feature off.

## Improvised Strike (Cosmere RPG)

Every character gets an **Improvised Strike** action. Using it asks which Light or Heavy melee weapon from the system's item compendium the improvised object stands in for, then makes that weapon's Strike with its damage and skill. The attack is a throwaway action; nothing about the choice is written to the character sheet, and other talents' triggers (including graze) work on it as on any Strike. The GM's client adds the action to existing characters on load and to new ones as they are created; the world setting **Improvised Strike action** turns it off.

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
