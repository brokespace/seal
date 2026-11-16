/** One remote command per manager that puts the launcher in place and registers the service. */
import { printLinesCommand, writeSealServerLauncherCommand } from './seal-server-launch-record'
import {
  SEAL_SERVICE_LAUNCH_RECORD_WORD,
  SEAL_SERVICE_LAUNCHD_AGENTS_DIR_WORD,
  SEAL_SERVICE_LAUNCHD_LABEL,
  SEAL_SERVICE_LAUNCHD_PLIST_WORD,
  SEAL_SERVICE_LAUNCHER_WORD,
  SEAL_SERVICE_MANAGER_MARKER_WORD,
  SEAL_SERVICE_NAME,
  SEAL_SERVICE_SYSTEMD_UNIT,
  SEAL_SERVICE_SYSTEMD_UNIT_DIR_WORD,
  SEAL_SERVICE_SYSTEMD_UNIT_WORD,
  sealServiceBinAssignment
} from './seal-service-host-layout'
import {
  SEAL_LAUNCHD_BOOTOUT,
  SEAL_LINGER_ANSWER,
  SEAL_PM2_SAVE_FUNCTION,
  SEAL_SYSTEMD_USER_SESSION,
  sealPm2StartCommand,
  sealServiceUnregisterCommand
} from './seal-service-manager-commands'
import type { SealServiceManager } from './seal-service-policy'
import { parseSealLinger, parseSealServiceAnswer } from './seal-service-probe'
import { renderSealServiceLaunchAgent, renderSealServiceSystemdUnit } from './seal-service-unit'

function writeFileCommand(content: string, directory: string, file: string): string {
  const lines = content.replace(/\n$/u, '').split('\n')
  return `mkdir -p ${directory} && ${printLinesCommand(lines)} > ${file}.$$ && mv -f ${file}.$$ ${file}`
}

/** The steps whose failure means this manager refuses the service. */
function registerCommand(manager: SealServiceManager, managedRoot: string): string {
  switch (manager) {
    case 'systemd-user':
      return (
        `${SEAL_SYSTEMD_USER_SESSION} ` +
        `${writeFileCommand(renderSealServiceSystemdUnit(managedRoot), SEAL_SERVICE_SYSTEMD_UNIT_DIR_WORD, SEAL_SERVICE_SYSTEMD_UNIT_WORD)} && ` +
        `systemctl --user daemon-reload && systemctl --user enable ${SEAL_SERVICE_SYSTEMD_UNIT}`
      )
    case 'launchd':
      return (
        `${writeFileCommand(renderSealServiceLaunchAgent(managedRoot), SEAL_SERVICE_LAUNCHD_AGENTS_DIR_WORD, SEAL_SERVICE_LAUNCHD_PLIST_WORD)} && ` +
        // Clears an earlier `launchctl disable`, which would refuse the bootstrap.
        `{ ${SEAL_LAUNCHD_BOOTOUT} launchctl enable "user/$seal_uid/${SEAL_SERVICE_LAUNCHD_LABEL}" >/dev/null 2>&1; ` +
        `launchctl bootstrap "user/$seal_uid" ${SEAL_SERVICE_LAUNCHD_PLIST_WORD}; }`
      )
    case 'pm2':
      // PM2 refuses a second start under the same name.
      return (
        `cd "$seal_bin" && { pm2 delete ${SEAL_SERVICE_NAME} >/dev/null 2>&1; ` +
        `${sealPm2StartCommand()} >/dev/null; }`
      )
  }
}

function afterRegisterCommand(manager: SealServiceManager): string {
  switch (manager) {
    case 'systemd-user':
      // Refused where polkit is absent or denies it: the service then lasts only while the user manager runs.
      return `loginctl enable-linger "$(id -un)" >/dev/null 2>&1; ${SEAL_LINGER_ANSWER}`
    case 'launchd':
      return ''
    case 'pm2':
      return `${SEAL_PM2_SAVE_FUNCTION} seal_pm2_save;`
  }
}

/** Always exits 0 and answers `installed=1`, or `installed=0` with a `reason`, having undone what it registered. */
export function sealServiceInstallCommand(input: {
  manager: SealServiceManager
  /** Absolute: the unit and plist name the launcher by its full path. */
  managedRoot: string
  /** The manager the host's marker names, when it is another one that no longer works. */
  replaces: SealServiceManager | null
}): string {
  const { manager, managedRoot, replaces } = input
  return [
    sealServiceBinAssignment(managedRoot),
    'seal_refused() { echo installed=0; echo "reason=$(printf %s "$1" | tail -n 1)"; exit 0; };',
    // Registration may start the launcher at once; it must find no slot from an earlier launch.
    `seal_out=$({ ${writeSealServerLauncherCommand()} && rm -f ${SEAL_SERVICE_LAUNCH_RECORD_WORD}; } 2>&1) ||`,
    'seal_refused "$seal_out";',
    ...(replaces && replaces !== manager
      ? [`${sealServiceUnregisterCommand(replaces)} rm -f ${SEAL_SERVICE_MANAGER_MARKER_WORD};`]
      : []),
    `seal_out=$({ ${registerCommand(manager, managedRoot)}; } 2>&1) ||`,
    // A manager that refused holds nothing, so the host must not claim a service.
    `{ ${sealServiceUnregisterCommand(manager)}`,
    `rm -f ${SEAL_SERVICE_MANAGER_MARKER_WORD} ${SEAL_SERVICE_LAUNCHER_WORD};`,
    'seal_refused "$seal_out"; };',
    `( umask 077; echo ${manager} > ${SEAL_SERVICE_MANAGER_MARKER_WORD} ) ||`,
    "seal_refused 'the manager marker could not be written';",
    'echo installed=1;',
    afterRegisterCommand(manager)
  ].join(' ')
}

export type SealServiceInstallAnswer = {
  installed: boolean
  reason: string | null
  /** systemd only; null when logind did not answer. */
  linger: boolean | null
}

export function parseSealServiceInstallAnswer(output: string): SealServiceInstallAnswer {
  const answer = parseSealServiceAnswer(output)
  return {
    installed: answer.get('installed') === '1',
    reason: answer.get('reason') || null,
    linger: parseSealLinger(answer.get('linger'))
  }
}
