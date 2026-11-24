# cosmere-foundry-modules

Foundry VTT modules for the Cosmere RPG, one per folder under `modules/`.

| Module | Description |
|---|---|
| [`table-ledger`](modules/table-ledger) | Table aids for GMs and players: endeavour tracker, goals board, world clock, session recaps, target picker and ability audit. |

## Install

In Foundry's **Add-on Modules → Install Module**, paste the module's manifest URL:

| Module | Manifest URL |
|---|---|
| `table-ledger` | `https://raw.githubusercontent.com/sazap10/cosmere-foundry-modules/main/modules/table-ledger/module.json` |

## Develop

```bash
npm install          # npm workspaces; installs every module
npm run typecheck    # all modules
npm test
npm run build        # each module → modules/<id>/build/<id>
```

Run one module's scripts with `-w modules/<id>`.

## Release

Releases are automated with [release-please](https://github.com/googleapis/release-please), driven by [Conventional Commits](https://www.conventionalcommits.org/) on `main`:

- `feat:` commits bump the minor version, `fix:` the patch; `feat!:` or a `BREAKING CHANGE:` footer marks a breaking change.
- release-please keeps a release PR open that bumps each changed module's `package.json`, `module.json` and `CHANGELOG.md`. The workflow also points `module.json`'s `download` at the new release.
- Merging the release PR tags `<id>-v<version>` (e.g. `table-ledger-v0.2.0`) and creates the GitHub release; the workflow then builds the module and attaches `module.json` and `<id>.zip`.

Foundry checks for updates against `module.json` on `main`, so merging a release PR is what publishes an update.

## Adding a module

Create `modules/<id>/` with its own `package.json` (`build`, `typecheck`, `test`, `zip` scripts), `module.json` and sources, then add it to `release-please-config.json` and `.release-please-manifest.json`.
