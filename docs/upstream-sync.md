# Syncing Seal with upstream Orca

Seal is a fork of [stablyai/orca](https://github.com/stablyai/orca). Upstream is merged in every week, so the fork is arranged to make that merge small:

- Bundled source and the locale catalogs keep **upstream's text on disk**. "Orca" becomes "Seal" while building and testing, and Seal's own strings live in separate overlay files.
- Seal's identity (name, ids, URLs, signing) is one config file that the build scripts read.
- Generated files are rebuilt by a script and never merged by hand.
- `pnpm seal:rebrand-check` fails if upstream's name reaches a user.

Internal names stay upstream's on purpose: the `orca` package and CLI alias, `ORCA_*` env vars, the `orca://` scheme, `~/.orca`, `orcad`, file and module names.

## One-time setup

```bash
git remote add upstream https://github.com/stablyai/orca.git
git config rerere.enabled true      # remember each conflict resolution
git config rerere.autoupdate true   # and stage it when it replays
```

`git rerere` records how a conflict was resolved and replays it the next time the same conflict appears, which matters here because the same Seal edits meet upstream every week.

## Weekly sync

Merge, never rebase: `seal/all` is shared and is never force-pushed.

```bash
git fetch origin seal/all && git fetch upstream main
git checkout -b seal/upstream-sync-$(date +%Y-%m-%d) origin/seal/all
git merge upstream/main                # expect conflicts

pnpm seal:sync:resolve                 # settles rebrand-only and generated-file conflicts
# resolve what it lists as left, then `git add` those files
pnpm install                           # pnpm resolves pnpm-lock.yaml conflicts itself
pnpm seal:regenerate                   # rebrand new in-place copy, rebuild generated files
git add -A && git commit               # concludes the merge

pnpm seal:rebrand-check
pnpm tc && pnpm lint && pnpm test --maxWorkers=2
pnpm build:orcad && pnpm -C mobile typecheck
```

Open the PR into `brokespace/seal` `seal/all`. Never push to or open PRs against `stablyai/orca`.

What each step does:

| Command                                   | Effect                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm seal:sync:resolve`                  | For each conflicted file that Seal rebranded in place, rebrands both of upstream's sides and redoes the three-way merge, which removes every conflict that was only the name. Takes upstream's side of generated files (the skill digest ledger is unioned, because it is add-only). Deletes files upstream deleted that Seal had only rebranded. Prints what still needs a person. |
| `pnpm seal:regenerate`                    | Runs `pnpm seal:rebrand-apply`, then every generator in `config/seal/upstream-sync/generated-files.mjs`. Safe to rerun.                                                                                                                                                                                                                                                             |
| `pnpm seal:rebrand-apply`                 | Rewrites "Orca" to "Seal" in the files no build produces (below). `--dry-run --list` shows what it would change.                                                                                                                                                                                                                                                                    |
| `pnpm seal:rebrand-check`                 | See [Rebrand check](#rebrand-check).                                                                                                                                                                                                                                                                                                                                                |
| `pnpm seal:sync:restore --upstream=<ref>` | Puts bundled source and catalogs back to upstream's text wherever Seal's copy is only the rebrand, moving Seal's strings to the overlays. Run it after [merging a Seal branch that was written before the overlay existed](#merging-a-seal-branch-written-before-the-overlay). `<ref>` is the upstream commit the branch contains, usually `$(git merge-base upstream/main HEAD)`.  |

If upstream adds a new outbound service (update feed, analytics, crash or feedback endpoint), gate it in `src/main/upstream-service-policy.ts` before merging.

## How the name is applied

| Surface                                                                                                                                           | On disk             | Where "Seal" comes from                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`, `mobile/app`, `mobile/src`, `mobile/web-entry`                                                                                            | upstream's text     | The brand pass, at build and test time: Vite (`electron.vite.config.ts`, `vite.web.config.ts`), Vitest, esbuild (orcad, WSL guest, mobile web bundle), Metro (`mobile/metro.config.js`), and the emitted CLI (`build:cli`). |
| `src/renderer/src/i18n/locales`, `mobile/src/i18n/locales`, `en-runtime-required.json`                                                            | upstream's catalogs | Same pass, then Seal's overlay is laid over the result.                                                                                                                                                                     |
| `tests/`, `config/scripts/`, `mobile/scripts/`, `docs/`, `docs/site/`, `mobile/locales/`, `mobile/app.json`, `config/electron-builder.config.cjs` | rebranded in place  | `pnpm seal:rebrand-apply`. Nothing bundles these, so they are edited in the tree; `seal:sync:resolve` reapplies the same rewrite to upstream's side during a merge.                                                         |
| `resources/`, `native/`, `.github/`, launchers                                                                                                    | edited by hand      | Small, rarely touched upstream; `git rerere` covers repeats.                                                                                                                                                                |

The pass rewrites only string literals, template text and JSX text, and only where "Orca" is the product name: identifiers, paths, URLs, env names, markers written into user files, and attribution ("forked from Orca", "Orca authors") are left alone. The rules are in `config/seal/brand-copy/seal-brand-copy.mjs`; files that must keep the name are listed with the reason in `seal-brand-source.mjs` (`SKIPPED_SOURCE_FILES`).

Because tests run through the same pass, a test under `src/` asserts upstream's text in its source and passes against Seal's output. Do not hand-edit "Orca" to "Seal" in those roots: the edit is a diff against upstream that the build would have made anyway.

A build step that reads source or catalogs without a bundler (the mobile web bundle's per-locale catalog copies, for example) needs its own hook; `seal:rebrand-check --built` is what catches a missing one. The Metro pass loads `oxc-parser` from the repo root, so a native mobile build needs `pnpm install` at the root as well as in `mobile/`; without it the build stops with a module-not-found error.

### Locale overlay

Each surface has an overlay directory beside its catalogs:

```text
src/renderer/src/i18n/seal-overrides/<locale>.json   # Seal's keys, and rewordings of upstream keys
src/renderer/src/i18n/seal-overrides/removed-keys.json
mobile/src/i18n/seal-overrides/...
```

The shipped catalog is upstream's catalog, rebranded, minus `removed-keys.json`, with the overlay merged on top.

- **A Seal-only string**: add the key to `seal-overrides/en.json` (and translations to the other locales' overlays). `pnpm sync:localization-catalog` writes new keys to the overlay for you.
- **Rewording an upstream string**: put the same key in the overlay with Seal's text. Leave the source default as upstream wrote it.
- **Seal removed a UI that upstream localizes**: list its keys in `removed-keys.json`, otherwise the catalog gates report them as unused.

Upstream's localization gates (`pnpm verify:localization-*`) read catalogs through `config/seal/locale-overlay/seal-catalog-gate-fs.mjs`, a stand-in for `node:fs/promises` that shows them the merged view and splits `--fix` writes back between upstream's file and the overlay. That one-line import swap is Seal's only change to those scripts.

### Merging a Seal branch written before the overlay

Such a branch has Seal's name in bundled source and edits upstream's catalogs in place, so every line naming the product conflicts with `seal/all`:

```bash
git merge origin/<branch>              # expect conflicts
pnpm seal:sync:resolve-branch          # rebrands all three sides of bundled source and redoes the merge; takes the Seal-worded side of catalogs
# resolve what it lists as left, then `git add` those files
pnpm seal:sync:restore --upstream=$(git merge-base HEAD upstream/main)
pnpm seal:regenerate
git add -A && git commit
```

Run the restore before committing the merge: it moves the branch's strings to the overlay, drops Seal keys the branch deleted from the overlay, records upstream keys it deleted in `removed-keys.json`, and puts source and catalogs back to upstream's text. `pnpm seal:rebrand-check` fails while a catalog under `locales/` still holds Seal's name.

## Seal-owned files

These exist only in Seal, so upstream never conflicts with them:

- `config/seal/**`: branding config, brand pass, overlay tooling, sync tooling, rebrand check.
- `src/**/seal-overrides/**`, `mobile/src/i18n/seal-overrides/**`: locale overlays.
- `docs/upstream-sync.md`, `docs/TESTING-seal-all.md`, `docs/live-sessions-*.md`, `docs/home-chat-architecture.md`.
- Seal features, for example `src/main/machines/**`, `src/main/live-sessions/**`, `src/main/home-chat/**`, `src/shared/seal-accounts/**`. `git diff --name-only --diff-filter=A $(git merge-base upstream/main HEAD)` lists every file Seal added.
- Icons: `resources/build/icon.*`, `resources/icon*.png`, `resources/logo.svg`, `resources/tray/`, `resources/app-icons/`, `resources/icon-source/seal-app-icon.svg`, `mobile/assets/*.png`. Upstream changes to these are always resolved to Seal's.

Hook points in upstream files are kept to a line or two each; `pnpm seal:rebrand-check` lists them (`BRAND_PASS_HOOKS`) and fails if a merge drops one.

### Branding config

`config/seal/seal-branding.cjs` holds the product name, app and bundle ids, CLI command, repository and release owner, Linux package and executable names, macOS helper names and the signing team. Build scripts read it:

- `config/electron-builder.config.cjs` keeps upstream's values and ends with one line that hands the config to `config/seal/seal-electron-builder.cjs`, which lays Seal's identity over it.
- `config/scripts/native-build/macos/*.mjs` read the bundle ids.
- `SEAL_MAC_TEAM_ID` sets the Apple team a release build verifies its helpers against. It is unset today: Seal has no Developer ID, and nothing is pinned to upstream's team.

The constants compiled into the app (`src/shared/app-identity.ts`, `src/shared/local-build-compatibility-contract.{ts,json}`, `src/main/startup/profile-startup/dev-instance-identity.ts`, `src/main/cli/installation/cli-install-constants.ts`, `src/shared/appimage-cache-identity.ts`) repeat a few of those values because the CLI build cannot import from `config/`. The rebrand check compares them with the config.

## Generated files

Never resolve a conflict in these by hand. Take either side (`seal:sync:resolve` does) and run `pnpm seal:regenerate`:

| File                                                                                                                                                 | Generator                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/shared/rpc-contract/rpc-params-catalog.generated.ts`                                                                                            | `pnpm generate:rpc-params-catalog`                                        |
| `skill-guides/orca-plugin-authoring/references/*.md`                                                                                                 | `pnpm generate:plugin-authoring-skill-references`                         |
| `src/cli/skills/bundled-skill-guides.ts`                                                                                                             | `pnpm generate:bundled-skill-guides`                                      |
| `resources/skills/current-manifest.json`, `resources/skills/released-digests.json`, `src/main/skills/bundled-skill-install/bundled-skill-sources.ts` | `pnpm generate:skill-bundle-manifest`                                     |
| `src/renderer/src/i18n/en-runtime-required.json`, `mobile/src/i18n/en-runtime-required.json`                                                         | `pnpm sync:localization-runtime-catalog`, `pnpm sync:mobile-localization` |
| `src/shared/plugins/languages/protected-copy-keys.json`                                                                                              | `pnpm sync:localization-protected-copy`                                   |
| `pnpm-lock.yaml`                                                                                                                                     | `pnpm install`                                                            |

`released-digests.json` only ever grows: it lists every `SKILL.md` a build has shipped, so an untouched install can be recognised and upgraded. A merge keeps both sides' digests.

The skills, skill guides and the generated files built from them are agent-facing and keep upstream's wording, `orca` command included.

## Rebrand check

```bash
pnpm seal:rebrand-check            # source-level; scans out/ too when it is built
pnpm build:cli && pnpm build:electron-vite && pnpm seal:rebrand-check --built
```

It fails on a user-visible "Orca" in:

- the locale catalogs as shipped (upstream, rebranded, plus overlay), desktop and mobile;
- bundled source after the brand pass: menus, window titles, notifications, dialogs, CLI help;
- the built app under `out/`, which proves each bundler applied the pass (`--built` requires it);
- installer metadata: the electron-builder config, `package.json`, `mobile/app.json`;
- launchers, packaging scripts, native permission prompts and GitHub issue forms;
- the docs site (`docs/site/content`);
- any in-place file `pnpm seal:rebrand-apply` would still change.

It also fails when a brand-pass hook is missing from a bundler config, or an identity constant disagrees with `seal-branding.cjs`.

Intentional mentions are allowlisted in `config/seal/rebrand-check/seal-rebrand-allowlist.mjs`, each with its reason: attribution, the `orca` CLI alias, ids other programs read (`TERM_PROGRAM`, Codex `clientInfo`, Jira `User-Agent`), markers in files Seal manages for the user, and agent-facing skills. When the check fails after a sync, the fix is almost always a rule in `seal-brand-copy.mjs` or an overlay entry, not an allowlist line.

## When a conflict needs judgment

After `seal:sync:resolve`, what is left is where both sides changed behaviour. Keep upstream's fix and reapply Seal's feature on top of it:

- Seal features to preserve: the rebrand, unified Machines (SSH and Seal server), multi-account auto-swap, live sessions and the Active agents sidebar, Home overview and home chat, the Machines tab, mobile and the Cloudflare relay.
- Upstream deleted a file Seal changed: check whether the behaviour moved; if Seal's change was to a test upstream retired, delete it.
- Upstream changed code Seal replaced (the accounts settings pane, for example): keep Seal's version and port the fix if it still applies.

Record anything non-obvious in the merge commit message so the next sync can follow it.
