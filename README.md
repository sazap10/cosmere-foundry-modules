# foundry-modules

Foundry VTT modules, one per folder under `modules/`.

| Module | Description |
|---|---|
| [`table-ledger`](modules/table-ledger) | Endeavour tracker, goals board, world clock, session recaps, target picker and ability audit. Cosmere RPG adapter; D&D 5e planned. |

## Develop

```bash
npm install          # npm workspaces; installs every module
npm run typecheck    # all modules
npm test
npm run build        # each module → modules/<id>/build/<id>
```

Run one module's scripts with `-w modules/<id>`.

## Release

Each module releases on its own tag, `<id>-v<version>` (e.g. `table-ledger-v0.2.0`).

1. In a PR, bump `modules/<id>/module.json`: `version`, and `download` to `https://github.com/sazap10/foundry-modules/releases/download/<id>-v<version>/<id>.zip`.
2. Merge, then push the tag. `.github/workflows/release.yml` checks the manifest matches the tag, builds that module, and publishes `module.json` + `<id>.zip` as the release.

Foundry's manifest URL for a module is its `module.json` on `main`:
`https://raw.githubusercontent.com/sazap10/foundry-modules/main/modules/<id>/module.json`.

## Adding a module

Create `modules/<id>/` with its own `package.json` (`build`, `typecheck`, `test`, `zip` scripts), `module.json` and sources. Code shared between modules can move to a `packages/` workspace once a second module needs it.
