// Seal registers its own command so an installed Orca keeps `orca`; the bundled launchers keep upstream names.
export const INSTALLED_CLI_COMMAND_NAME = 'seal'
export const DEFAULT_MAC_COMMAND_PATH = `/usr/local/bin/${INSTALLED_CLI_COMMAND_NAME}`
export const DEV_COMMAND_NAME = 'orca-dev'
export const LEGACY_LINUX_COMMAND_NAME = 'orca'
export const DEV_LAUNCHER_DIR = ['cli', 'bin'] as const
// Cold PowerShell start plus the WM_SETTINGCHANGE broadcast exceeded 5 s on low-spec machines.
export const WINDOWS_PATH_WRITE_TIMEOUT_MS = 15_000
