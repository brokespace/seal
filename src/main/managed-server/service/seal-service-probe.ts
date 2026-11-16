/** One remote command that tells which service managers the host has and which one holds the server. */
import {
  SEAL_SERVICE_LAUNCHER_WORD,
  SEAL_SERVICE_MANAGER_MARKER_WORD,
  SEAL_SERVICE_NAME,
  SEAL_SERVICE_SYSTEMD_UNIT,
  sealServiceBinAssignment
} from './seal-service-host-layout'
import {
  SEAL_LAUNCHD_LOADED_FUNCTION,
  SEAL_LAUNCHD_UID,
  SEAL_LINGER_ANSWER,
  SEAL_PM2_LIVE_FUNCTION,
  SEAL_SYSTEMD_USER_SESSION
} from './seal-service-manager-commands'
import type { SealServiceProbe } from './seal-service-manager-selection'
import type { SealServiceManager, SealServiceOutcome } from './seal-service-policy'

const MANAGERS: readonly SealServiceManager[] = ['systemd-user', 'launchd', 'pm2']

/** Without a root the login home's managed root is probed. Read-only, and never spawns a PM2 daemon. */
export function sealServiceProbeCommand(managedRoot?: string): string {
  return [
    sealServiceBinAssignment(managedRoot),
    SEAL_SYSTEMD_USER_SESSION,
    SEAL_LAUNCHD_UID,
    SEAL_LAUNCHD_LOADED_FUNCTION,
    SEAL_PM2_LIVE_FUNCTION,
    'seal_flag() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; };',
    'seal_user=$(id -un 2>/dev/null);',
    'echo "platform=$(uname -s 2>/dev/null)";',
    'echo "systemd=$(seal_flag systemctl --user show-environment)";',
    'echo "launchctl=$(seal_flag command -v launchctl)";',
    'echo "pm2=$(seal_flag command -v pm2)";',
    `seal_marker=$(head -n 1 ${SEAL_SERVICE_MANAGER_MARKER_WORD} 2>/dev/null); echo "marker=$seal_marker";`,
    'case "$seal_marker" in',
    `systemd-user) seal_held=$(seal_flag systemctl --user is-enabled ${SEAL_SERVICE_SYSTEMD_UNIT});;`,
    'launchd) seal_held=$(seal_flag seal_launchd_loaded);;',
    `pm2) seal_held=$(seal_pm2_live && seal_flag pm2 describe ${SEAL_SERVICE_NAME} || echo 0);;`,
    '*) seal_held=0;; esac;',
    `[ -x ${SEAL_SERVICE_LAUNCHER_WORD} ] || seal_held=0; echo "registered=$seal_held";`,
    SEAL_LINGER_ANSWER,
    // `pm2 startup` installs a system unit, an init script or a per-user launchd agent.
    'seal_boot=; if [ "$(uname -s 2>/dev/null)" = Darwin ]; then',
    'seal_boot=$(seal_flag test -e "$HOME/Library/LaunchAgents/pm2.$seal_user.plist");',
    'elif [ -d /run/systemd/system ]; then',
    'seal_boot=$(seal_flag systemctl is-enabled "pm2-$seal_user.service");',
    'elif [ -e "/etc/init.d/pm2-$seal_user" ]; then seal_boot=1; fi;',
    'echo "pm2_startup=$seal_boot"'
  ].join(' ')
}

export function parseSealServiceAnswer(output: string): Map<string, string> {
  const answer = new Map<string, string>()
  for (const line of output.split(/\r?\n/u)) {
    const at = line.indexOf('=')
    if (at > 0) {
      answer.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
    }
  }
  return answer
}

export function parseSealLinger(value: string | undefined): boolean | null {
  return value === 'Linger=yes' ? true : value === 'Linger=no' ? false : null
}

function flag(value: string | undefined): boolean | null {
  return value === '1' ? true : value === '0' ? false : null
}

/** Null when the host did not answer the probe: nothing is known, so nothing may be installed. */
export function parseSealServiceProbe(output: string): SealServiceProbe | null {
  const answer = parseSealServiceAnswer(output)
  const uname = answer.get('platform')
  if (!uname) {
    return null
  }
  const marker = answer.get('marker')
  return {
    platform: uname === 'Linux' ? 'linux' : uname === 'Darwin' ? 'darwin' : 'other',
    systemdUser: answer.get('systemd') === '1',
    launchctl: answer.get('launchctl') === '1',
    pm2: answer.get('pm2') === '1',
    installed: MANAGERS.find((manager) => manager === marker) ?? null,
    registered: answer.get('registered') === '1',
    linger: parseSealLinger(answer.get('linger')),
    pm2StartsAtBoot: flag(answer.get('pm2_startup'))
  }
}

/** What the machine registry records for a host kept by `manager`. */
export function sealServiceOutcome(
  manager: SealServiceManager,
  host: Pick<SealServiceProbe, 'linger' | 'pm2StartsAtBoot'>
): SealServiceOutcome {
  switch (manager) {
    case 'systemd-user':
      return { manager, linger: host.linger === true }
    case 'pm2':
      return { manager, startsAtBoot: host.pm2StartsAtBoot }
    case 'launchd':
      return { manager }
  }
}
