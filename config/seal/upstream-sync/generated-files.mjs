// Files a script writes from other files. A merge never edits them by hand: take either side and
// rerun `pnpm seal:regenerate` (docs/upstream-sync.md).
export const RELEASED_DIGESTS_PATH = 'resources/skills/released-digests.json'

export const GENERATED_FILES = [
  'resources/skills/current-manifest.json',
  RELEASED_DIGESTS_PATH,
  'src/main/skills/bundled-skill-install/bundled-skill-sources.ts',
  'src/cli/skills/bundled-skill-guides.ts',
  'skill-guides/orca-plugin-authoring/references/cli.md',
  'skill-guides/orca-plugin-authoring/references/events.md',
  'skill-guides/orca-plugin-authoring/references/host-api.md',
  'skill-guides/orca-plugin-authoring/references/manifest.md',
  'src/shared/rpc-contract/rpc-params-catalog.generated.ts',
  'src/shared/plugins/languages/protected-copy-keys.json',
  'src/renderer/src/i18n/en-runtime-required.json',
  'mobile/src/i18n/en-runtime-required.json'
]

/** In dependency order: later generators read what earlier ones wrote. */
export const REGENERATE_SCRIPTS = [
  'generate:rpc-params-catalog',
  'generate:plugin-authoring-skill-references',
  'generate:bundled-skill-guides',
  'generate:skill-bundle-manifest',
  'sync:localization-catalog',
  'sync:localization-runtime-catalog',
  'sync:localization-protected-copy',
  'sync:mobile-localization'
]
