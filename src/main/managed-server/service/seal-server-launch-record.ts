/** The stable launcher a service manager runs, and the launch record naming the slot it starts. */
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { SEAL_SERVER_SERVICE_ENV } from '../../../shared/orcad-managed-launch-env'
import { SEAL_MANAGED_SERVICE_PORT } from '../../../shared/orcad-managed-runtime'
import {
  joinRemotePath,
  remoteDirname,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import { ORCAD_PID_FILENAME } from '../install/orcad-remote-host-support'
import type { OrcadLaunchSpec } from '../install/orcad-remote-launch'
import { selectOrcadSlotRuntimeCommand } from '../install/orcad-remote-runtime'
import {
  SEAL_SERVICE_LAUNCH_RECORD_WORD,
  SEAL_SERVICE_LAUNCHER_WORD,
  SEAL_SERVICE_NAME,
  sealServiceBinAssignment
} from './seal-service-host-layout'
import { sealServiceRestartCommand } from './seal-service-manager-commands'
import type { SealServiceManager } from './seal-service-policy'

/** A service manager's own PATH is minimal and would hide agent CLIs under the user's home. */
const LOGIN_ENV_NAMES = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE']

// Static: updates rewrite the record beside it, never this file.
const LAUNCHER_LINES = [
  '#!/bin/sh',
  '# Seal server launcher: starts the server slot the last managed launch chose.',
  `seal_launch="\${0%/*}/${SEAL_SERVICE_NAME}.launch"`,
  '[ -r "$seal_launch" ] || exit 0',
  '. "$seal_launch"'
]

export function printLinesCommand(lines: readonly string[]): string {
  return `printf '%s\\n' ${lines.map(quotePosixShell).join(' ')}`
}

/** Needs $seal_bin. */
export function writeSealServerLauncherCommand(): string {
  const temp = `${SEAL_SERVICE_LAUNCHER_WORD}.$$`
  return (
    `( umask 077; mkdir -p "$seal_bin" && ${printLinesCommand(LAUNCHER_LINES)} > ${temp} && ` +
    `chmod 700 ${temp} && mv -f ${temp} ${SEAL_SERVICE_LAUNCHER_WORD} )`
  )
}

/** Without a record the launcher exits 0: a manager that still holds the service then starts nothing. */
export function dropSealServerLaunchRecordCommand(managedRoot: string): string {
  return `${sealServiceBinAssignment(managedRoot)} rm -f ${SEAL_SERVICE_LAUNCH_RECORD_WORD}`
}

export function sealServiceManagedRoot(host: RemoteHostPlatform, remoteInstallDir: string): string {
  return remoteDirname(remoteInstallDir.replace(/\/+$/u, ''), host)
}

/** Quotes the launching shell's values into $seal_env as sh assignments. */
const CAPTURE_LOGIN_ENV =
  `seal_env=; for seal_name in ${LOGIN_ENV_NAMES.join(' ')}; do ` +
  'eval "seal_set=\\${$seal_name+x} seal_value=\\${$seal_name-}"; ' +
  '[ -z "$seal_set" ] || ' +
  'seal_env="$seal_env $seal_name=\'$(printf %s "$seal_value" | sed "s/\'/\'\\\\\\\\\'\'/g")\'"; done;'

export type SealServiceLaunchParts = {
  /** Shell words exactly as the detached launch uses them; readiness and log are slot-relative. */
  entry: string
  readiness: string
  log: string
  launchEnv: readonly string[]
  runtimeV8Flags: string
}

/** PM2 reports a signal death as exit 0, which it would not restart: keep a shell that reports it nonzero. */
function superviseRuntimeLines(run: string, pidFile: string): string[] {
  return [
    `${run} &`,
    `seal_child=$!; umask 077; echo "$seal_child" > ${pidFile}`,
    'trap \'kill -TERM "$seal_child" 2>/dev/null\' INT TERM',
    // A trapped signal ends `wait` early; only the child's own status may leave the loop.
    'while kill -0 "$seal_child" 2>/dev/null; do wait "$seal_child"; seal_status=$?; done',
    'exit "$seal_status"'
  ]
}

/** Replaces the detached tail: record the slot, then have the manager start it. Runs after the shared launch prefix. */
export function sealServiceLaunchTail(
  host: RemoteHostPlatform,
  manager: SealServiceManager,
  spec: OrcadLaunchSpec,
  parts: SealServiceLaunchParts
): string[] {
  const pidFile = quotePosixShell(joinRemotePath(host, spec.remoteInstallDir, ORCAD_PID_FILENAME))
  const run = [
    ...parts.launchEnv,
    `${SEAL_SERVER_SERVICE_ENV}=1`,
    ...(manager === 'pm2' ? [] : ['exec']),
    `"$orcad_runtime" $orcad_runtime_flags ${parts.runtimeV8Flags} ${parts.entry}`,
    // Not `spec.port`: a start at boot must never take the port a user's own `seal serve` is pinned to.
    `--json --bind ${quotePosixShell(spec.bindHost)} --port ${String(SEAL_MANAGED_SERVICE_PORT)}`
  ].join(' ')
  const beforeLoginEnv = [
    // A slot removed since the launch leaves nothing to keep running.
    `cd ${quotePosixShell(spec.remoteInstallDir)} 2>/dev/null || exit 0`,
    selectOrcadSlotRuntimeCommand(host, spec.remoteInstallDir, spec.nodePath),
    // Readiness carries the pairing token: open it owner-only before restoring the login umask.
    'umask 077',
    `exec > ${parts.readiness} 2>> ${parts.log} < /dev/null`,
    // exec keeps this shell's PID, so the recorded process is the runtime.
    ...(manager === 'pm2' ? [] : [`echo $$ > ${pidFile}`])
  ]
  const afterLoginEnv = manager === 'pm2' ? superviseRuntimeLines(run, pidFile) : [run]
  const temp = `${SEAL_SERVICE_LAUNCH_RECORD_WORD}.$$`
  return [
    `{ ${sealServiceBinAssignment(sealServiceManagedRoot(host, spec.remoteInstallDir))}`,
    CAPTURE_LOGIN_ENV,
    `{ ${printLinesCommand(beforeLoginEnv)};`,
    'printf \'%s\\n\' "umask $orcad_login_umask" "${seal_env:+export$seal_env}";',
    `${printLinesCommand(afterLoginEnv)}; } > ${temp} &&`,
    `mv -f ${temp} ${SEAL_SERVICE_LAUNCH_RECORD_WORD} &&`,
    'rm -f "$orcad_pid" &&',
    // The manager's daemon, if this spawns one, must not inherit the pairing umask.
    `( umask "$orcad_login_umask"; ${sealServiceRestartCommand(manager)} );`,
    // A refused restart must not be answered with the previous launch's PID.
    '} || exit $?;'
  ]
}
