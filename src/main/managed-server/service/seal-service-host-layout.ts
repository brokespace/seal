/** Names and host paths of the service that keeps a managed Seal server running. */
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { RELAY_REMOTE_DIR } from '../install/remote-install-root'

export const SEAL_SERVICE_NAME = 'seal-server'
export const SEAL_SERVICE_SYSTEMD_UNIT = `${SEAL_SERVICE_NAME}.service`
export const SEAL_SERVICE_LAUNCHD_LABEL = 'com.brokespace.seal.server'

const BIN_DIRNAME = 'bin'

/** Shell words; valid after `sealServiceBinAssignment` in the same command. */
export const SEAL_SERVICE_LAUNCHER_WORD = `"$seal_bin/${SEAL_SERVICE_NAME}"`
export const SEAL_SERVICE_LAUNCH_RECORD_WORD = `"$seal_bin/${SEAL_SERVICE_NAME}.launch"`
export const SEAL_SERVICE_MANAGER_MARKER_WORD = `"$seal_bin/${SEAL_SERVICE_NAME}.manager"`
export const SEAL_SERVICE_SYSTEMD_UNIT_DIR_WORD = '"$HOME/.config/systemd/user"'
export const SEAL_SERVICE_SYSTEMD_UNIT_WORD = `"$HOME/.config/systemd/user/${SEAL_SERVICE_SYSTEMD_UNIT}"`
export const SEAL_SERVICE_LAUNCHD_AGENTS_DIR_WORD = '"$HOME/Library/LaunchAgents"'
export const SEAL_SERVICE_LAUNCHD_PLIST_WORD = `"$HOME/Library/LaunchAgents/${SEAL_SERVICE_LAUNCHD_LABEL}.plist"`

function trimmed(managedRoot: string): string {
  return managedRoot.replace(/\/+$/u, '')
}

/** Without a root: the login home's managed root, for callers that hold only a connection. */
export function sealServiceBinAssignment(managedRoot?: string): string {
  const root =
    managedRoot === undefined
      ? `"$HOME"/${quotePosixShell(RELAY_REMOTE_DIR)}`
      : quotePosixShell(trimmed(managedRoot))
  return `seal_bin=${root}/${BIN_DIRNAME};`
}

/** The only path a unit, plist or PM2 entry runs; never a versioned directory. */
export function sealServiceLauncherPath(managedRoot: string): string {
  return `${trimmed(managedRoot)}/${BIN_DIRNAME}/${SEAL_SERVICE_NAME}`
}

/** launchd keeps the launcher's own output here; the server's goes to its slot. */
export function sealServiceLauncherLogPath(managedRoot: string): string {
  return `${sealServiceLauncherPath(managedRoot)}.log`
}
