/** For the machine page: what keeps a host's server running, and "Remove Seal server". */
import type { RemoteInstallTransport } from '../install/remote-install-transport'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'
import {
  SEAL_SERVICE_LAUNCH_RECORD_WORD,
  SEAL_SERVICE_LAUNCHD_PLIST_WORD,
  SEAL_SERVICE_LAUNCHER_WORD,
  SEAL_SERVICE_MANAGER_MARKER_WORD,
  SEAL_SERVICE_NAME,
  SEAL_SERVICE_SYSTEMD_UNIT,
  SEAL_SERVICE_SYSTEMD_UNIT_WORD,
  sealServiceBinAssignment
} from './seal-service-host-layout'
import { sealServiceUnregisterCommand } from './seal-service-manager-commands'
import {
  selectSealServiceCandidates,
  type SealServiceProbe
} from './seal-service-manager-selection'
import type { SealServiceOutcome, SealServiceWish } from './seal-service-policy'
import {
  parseSealServiceAnswer,
  parseSealServiceProbe,
  sealServiceOutcome,
  sealServiceProbeCommand
} from './seal-service-probe'

// A manager waits out the server's 90 s graceful shutdown before it answers.
const REMOVAL_TIMEOUT_MS = 120_000

export type SealServiceHostOptions = {
  /** Skips platform detection for a caller that already knows the host. */
  host?: RemoteHostPlatform
  /** Defaults to the login home's managed root. */
  managedRoot?: string
  signal?: AbortSignal
}

async function isPosixHost(
  conn: RemoteInstallTransport,
  options: SealServiceHostOptions
): Promise<boolean> {
  const host = options.host ?? (await detectRemoteHostPlatform(conn, { signal: options.signal }))
  return host !== null && !isWindowsRemoteHost(host)
}

async function probeHost(
  conn: RemoteInstallTransport,
  options: SealServiceHostOptions
): Promise<SealServiceProbe | null> {
  if (!(await isPosixHost(conn, options))) {
    return null
  }
  return parseSealServiceProbe(
    await execCommand(conn, sealServiceProbeCommand(options.managedRoot), {
      wrapCommand: true,
      signal: options.signal
    })
  )
}

/** Null when no manager holds the server: it is detached, or was never installed. */
export async function readSealServiceState(
  conn: RemoteInstallTransport,
  options: SealServiceHostOptions = {}
): Promise<SealServiceOutcome | null> {
  const probe = await probeHost(conn, options)
  return probe?.installed && probe.registered ? sealServiceOutcome(probe.installed, probe) : null
}

/** False when the host answered and has no manager the server could be registered with. */
export async function hasSealServiceManager(
  conn: RemoteInstallTransport,
  wish: SealServiceWish,
  options: SealServiceHostOptions = {}
): Promise<boolean> {
  const probe = await probeHost(conn, options)
  return !probe || selectSealServiceCandidates(probe, wish)[0] !== 'detached'
}

/** Answers `left=` followed by what could not be removed; no marker means there is nothing to remove. */
export function sealServiceRemovalCommand(managedRoot?: string): string {
  const files = [
    SEAL_SERVICE_LAUNCHER_WORD,
    SEAL_SERVICE_LAUNCH_RECORD_WORD,
    SEAL_SERVICE_MANAGER_MARKER_WORD
  ]
  return [
    sealServiceBinAssignment(managedRoot),
    `seal_marker=$(head -n 1 ${SEAL_SERVICE_MANAGER_MARKER_WORD} 2>/dev/null);`,
    'seal_left=;',
    'case "$seal_marker" in',
    '"") echo left=; exit 0;;',
    `systemd-user) ${sealServiceUnregisterCommand('systemd-user')}`,
    `[ ! -e ${SEAL_SERVICE_SYSTEMD_UNIT_WORD} ] || seal_left="$seal_left ${SEAL_SERVICE_SYSTEMD_UNIT}";`,
    `! systemctl --user is-active --quiet ${SEAL_SERVICE_SYSTEMD_UNIT} 2>/dev/null ||`,
    'seal_left="$seal_left running-service";;',
    `launchd) ${sealServiceUnregisterCommand('launchd')}`,
    `[ ! -e ${SEAL_SERVICE_LAUNCHD_PLIST_WORD} ] || seal_left="$seal_left launchd-plist";`,
    '! seal_launchd_loaded || seal_left="$seal_left launchd-agent";;',
    `pm2) ${sealServiceUnregisterCommand('pm2')}`,
    `! { seal_pm2_live && pm2 describe ${SEAL_SERVICE_NAME} >/dev/null 2>&1; } ||`,
    'seal_left="$seal_left pm2-entry";;',
    'esac;',
    `rm -f ${files.join(' ')} ${SEAL_SERVICE_LAUNCHER_WORD}.log;`,
    `for seal_file in ${files.join(' ')}; do`,
    '[ ! -e "$seal_file" ] || seal_left="$seal_left ${seal_file##*/}"; done;',
    'echo "left=$seal_left"'
  ].join(' ')
}

/** Stops and disables the service and removes all of it; linger stays, the user may rely on it. */
export async function removeSealService(
  conn: RemoteInstallTransport,
  options: SealServiceHostOptions = {}
): Promise<void> {
  if (!(await isPosixHost(conn, options))) {
    return
  }
  const output = await execCommand(conn, sealServiceRemovalCommand(options.managedRoot), {
    wrapCommand: true,
    timeoutMs: REMOVAL_TIMEOUT_MS,
    signal: options.signal
  })
  const left = parseSealServiceAnswer(output).get('left')
  if (left === undefined) {
    throw new Error('The Seal server service could not be removed: the host did not answer.')
  }
  if (left !== '') {
    throw new Error(`The Seal server service could not be removed. Still on the host: ${left}.`)
  }
}
