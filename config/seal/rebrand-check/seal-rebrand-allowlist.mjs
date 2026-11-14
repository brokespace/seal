// What `pnpm seal:rebrand-check` reads beyond the catalogs, and the upstream names it lets through.
import { SKIPPED_SOURCE_FILES } from '../brand-copy/seal-brand-source.mjs'

const MANAGED_FILE_MARKER = 'marker in a file Seal manages; existing installs are found by it'

/**
 * Bundled source that still names upstream after the brand pass, with the reason. Each literal
 * here is read by another program or an earlier install, never shown as the product's name.
 */
export const BUNDLED_SOURCE_ALLOWLIST = new Map([
  ...SKIPPED_SOURCE_FILES,
  ['src/main/amp/agent-status-plugin-source.ts', MANAGED_FILE_MARKER],
  ['src/main/hermes/hermes-managed-plugin-source.ts', MANAGED_FILE_MARKER],
  ['src/main/dsh/dsh-home-patch.ts', MANAGED_FILE_MARKER],
  ['src/main/kimi/kimi-hook-config-toml.ts', MANAGED_FILE_MARKER],
  ['src/main/cli/wsl/wsl-cli-scripts.ts', MANAGED_FILE_MARKER],
  ['src/main/pty/shell-startup/shell-templates.ts', MANAGED_FILE_MARKER],
  ['src/main/daemon/pty-subprocess/spawn-environment.ts', 'TERM_PROGRAM, which CLIs match on'],
  [
    'src/main/providers/local-pty/local-pty-spawn-environment.ts',
    'TERM_PROGRAM, which CLIs match on'
  ],
  [
    'src/main/native-chat/agent-session-wire/publication/subscribers/agent-session-delta-coalescer.ts',
    'truncation marker stored in saved chats'
  ],
  ['src/shared/agent-session-handoff-context.ts', 'omission markers stored in saved chats']
])

/** Hook points that put the brand pass into a bundler: [file, text it must contain]. */
export const BRAND_PASS_HOOKS = [
  ['electron.vite.config.ts', 'sealBrandCopy()'],
  ['vite.web.config.ts', 'sealBrandCopy()'],
  ['config/vitest.config.ts', 'sealBrandCopy()'],
  ['mobile/vitest.config.ts', 'sealBrandCopy()'],
  ['mobile/metro.config.js', 'seal-brand-metro-transform-worker.cjs'],
  ['config/build-plugins/sandboxed-script-bundles.ts', 'sealBrandCopy()'],
  ['config/scripts/build/mobile-web-app/build-mobile-web-app-bundle.mjs', 'sealBrandCopyEsbuild()'],
  [
    'config/scripts/build/mobile-web-app/build-mobile-web-app-bundle.mjs',
    'await readShippedCatalogText('
  ],
  [
    'config/scripts/orcad-distribution/server-bundle/orcad-entry-build.mjs',
    'jsoncParserEsm, externalNativeAddons, sealBrandCopyEsbuild()]'
  ],
  [
    'config/scripts/orcad-distribution/server-bundle/orcad-entry-build.mjs',
    'plugins: [sealBrandCopyEsbuild()]'
  ],
  ['config/scripts/remote-host-build/wsl-guest/build-wsl-guest.mjs', 'sealBrandCopyEsbuild()'],
  ['package.json', 'config/seal/brand-copy/build-seal-cli.mjs'],
  ['config/electron-builder.config.cjs', 'applySealBranding(module.exports)']
]

/** Constants compiled into the app that must agree with config/seal/seal-branding.cjs. */
export function IDENTITY_CONSTANTS(branding) {
  return [
    ['package.json', `"productName": "${branding.productName}"`],
    ['package.json', `"${branding.cliCommand}": "./out/cli/index.js"`],
    ['src/shared/app-identity.ts', `APP_PRODUCT_NAME = '${branding.productName}'`],
    ['src/shared/local-build-compatibility-contract.ts', `appId: '${branding.appId}'`],
    ['src/shared/local-build-compatibility-contract.json', `"appId": "${branding.appId}"`],
    [
      'src/main/startup/profile-startup/dev-instance-identity.ts',
      `BASE_APP_USER_MODEL_ID = '${branding.appId}'`
    ],
    [
      'src/main/cli/installation/cli-install-constants.ts',
      `INSTALLED_CLI_COMMAND_NAME = '${branding.cliCommand}'`
    ],
    [
      'src/shared/appimage-cache-identity.ts',
      `LINUX_EXECUTABLE_NAME = '${branding.linux.executableName}'`
    ],
    [
      'native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/TrustedOrcaApplication.swift',
      `bundleId == "${branding.appId}"`
    ]
  ]
}

/**
 * Launchers, installer scripts, native prompts and GitHub forms: read line by line. README.md is
 * left out: below Seal's notice it is upstream's README, kept as attribution.
 */
export const USER_VISIBLE_TEXT_FILES = [
  '.github/SECURITY.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/other.yml',
  'config/nsis/orca-installer-hooks.nsh',
  'resources/darwin/bin/orca',
  'resources/linux/bin/orca-ide',
  'resources/linux/packaging/after-install.sh',
  'resources/linux/packaging/after-remove.sh',
  'resources/win32/bin/orca.cmd',
  'resources/win32/bin/seal.cmd',
  'native/computer-use-macos/Sources/OrcaComputerUseMacOS/main.swift',
  'native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/PermissionWindowCopy.swift',
  'native/computer-use-windows/runtime.ps1',
  'native/windows-agent-hook/app.manifest',
  'native/windows-agent-hook/build.rs',
  'native/windows-cli-launcher/app.manifest',
  'native/windows-cli-launcher/build.rs',
  'native/windows-cli-launcher/src/main.rs',
  'native/windows-cli-launcher/src/administrator_restart.rs'
]

export const DOCS_SITE_CONTENT = 'docs/site/content'

/** Build outputs scanned when present. */
export const BUILT_OUTPUT_DIRS = [
  'out/main',
  'out/preload',
  'out/renderer',
  'out/cli',
  'out/mobile-web',
  'out/orcad',
  'out/relay',
  'out/shared'
]

/** Lines in those files that name upstream on purpose. */
export const TEXT_LINE_ALLOWLIST = [
  // Executable names the Linux launcher probes for, upstream's included.
  /^\s*for candidate in /
]

/** Strings in the built app that name upstream and come from outside the brand pass. */
export const BUILT_COPY_ALLOWLIST = [
  // Attribution inside a vendored TextMate grammar.
  /^Adapted by Orca:/,
  // Thrown by a build stub (config/build-plugins/sucrase-unused-transformers.ts), never shown.
  /^this sucrase transform is not bundled in Orca$/,
  // Engineering notes in src/main/runtime/agent-state-rules/*.json; the app reads the rules only.
  /\b(?:pane|session title|rest sign|settles?)\b/,
  // Manifest of the chat-visuals plugin an agent loads; agent-facing like the skill it carries.
  /^Teaches an Orca chat agent /
]
