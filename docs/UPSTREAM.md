# Syncing Seal with upstream Orca

Seal is a fork of [stablyai/orca](https://github.com/stablyai/orca). The rebrand only touches user-facing strings, build metadata and a few identity constants, and it keeps upstream's internal names (`orca` package, `ORCA_*` env vars, `orca://` scheme, `~/.orca`, file paths), so most upstream changes merge cleanly.

## One-time setup

```bash
git remote add upstream https://github.com/stablyai/orca.git
git fetch upstream
```

## Sync

```bash
git fetch origin main
git fetch upstream
git checkout -b seal/sync-upstream-$(date +%Y%m%d) origin/main
git merge upstream/main
# resolve conflicts (see below), then:
pnpm install
pnpm tc && pnpm lint && pnpm check:changed
git push -u origin HEAD
```

Open the PR into `brokespace/seal` `main`. Never push to or open PRs against `stablyai/orca` from this fork.

Merge, don't rebase: `main` is shared and must never be force-pushed.

## Where conflicts land

When resolving, keep upstream's change and re-apply Seal's value:

| Area                 | Seal value                                                    | Files                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name         | `Seal`                                                        | `package.json` (`productName`), `src/shared/app-identity.ts` (`APP_PRODUCT_NAME`), `config/electron-builder.config.cjs`                                                                                                    |
| App / bundle id      | `com.brokespace.seal`                                         | `config/electron-builder.config.cjs`, `src/shared/local-build-compatibility-contract.{ts,json}`, `src/main/startup/profile-startup/dev-instance-identity.ts`, `native/computer-use-macos/.../TrustedOrcaApplication.swift` |
| Executables          | `Seal.app`, `Seal.exe`, Linux `seal` (deb/rpm package `seal`) | `config/electron-builder.config.cjs`, `src/shared/appimage-cache-identity.ts`, `native/windows-cli-launcher/src/main.rs`, `resources/darwin/bin/orca`, `resources/linux/**`                                                |
| CLI command          | `seal` (bundled launchers keep `orca` names)                  | `src/main/cli/installation/cli-install-constants.ts`, `resources/win32/bin/seal.cmd`                                                                                                                                       |
| Profile folder       | `Seal`                                                        | Electron derives it from `productName`; node-side copies use `APP_PRODUCT_NAME`                                                                                                                                            |
| Updates              | disabled                                                      | `src/main/upstream-service-policy.ts`, electron-builder `publish`                                                                                                                                                          |
| Telemetry / feedback | disabled                                                      | `electron.vite.config.ts` (PostHog and diagnostics literals pinned to `null`), `src/main/upstream-service-policy.ts`                                                                                                       |
| Copy                 | "Seal" in window titles, menus, tray, about, onboarding       | `src/renderer/src/i18n/locales/*.json` and the matching source defaults                                                                                                                                                    |
| Icons                | seal artwork                                                  | `resources/build/icon.*`, `resources/icon*.png`, `resources/logo.svg`, `resources/tray/`, `resources/app-icons/`                                                                                                           |

Locale merges: upstream adds keys constantly. Take upstream's file, then change "Orca" to "Seal" only for the keys listed in the rebrand PR. Don't do a blanket replace, because many strings name orca.dev services that are still Orca's.

New user-visible "Orca" strings that upstream adds don't conflict, so after each sync, grep for new ones in titles, menus and dialogs:

```bash
git diff ORIG_HEAD..HEAD -- src/renderer/src/i18n/locales/en.json | grep '^+.*Orca'
```

If upstream adds a new outbound service (update feed, analytics, crash or feedback endpoint), gate it in `src/main/upstream-service-policy.ts` before merging.
