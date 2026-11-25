/** Shell pieces that ask systemd, launchd or PM2 to hold, restart or drop the user service. */
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  SEAL_SERVICE_LAUNCHD_LABEL,
  SEAL_SERVICE_LAUNCHD_PLIST_WORD,
  SEAL_SERVICE_LAUNCHER_WORD,
  SEAL_SERVICE_NAME,
  SEAL_SERVICE_SYSTEMD_UNIT,
  SEAL_SERVICE_SYSTEMD_UNIT_DIR_WORD,
  SEAL_SERVICE_SYSTEMD_UNIT_WORD
} from './seal-service-host-layout'
import type { SealServiceManager } from './seal-service-policy'

/** The server's graceful shutdown must finish before a manager escalates to SIGKILL. */
const PM2_KILL_TIMEOUT_MS = 90_000

/** An SSH exec channel may carry no XDG_RUNTIME_DIR, which `systemctl --user` needs to find the bus. */
export const SEAL_SYSTEMD_USER_SESSION =
  'XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"; export XDG_RUNTIME_DIR;'

/** Answers `linger=Linger=yes`, `linger=Linger=no`, or an empty value when logind does not answer. */
export const SEAL_LINGER_ANSWER =
  'echo "linger=$(loginctl show-user "$(id -un)" -p Linger 2>/dev/null)";'

export const SEAL_LAUNCHD_UID = 'seal_uid=$(id -u);'

/** The one launchd domain Seal uses, as `seal serve service install` does; it exists only while the user is logged in at the screen. Needs `SEAL_LAUNCHD_UID`. */
export const SEAL_LAUNCHD_DOMAIN_WORD = '"gui/$seal_uid"'

const LAUNCHD_SERVICE_WORD = `"gui/$seal_uid/${SEAL_SERVICE_LAUNCHD_LABEL}"`

/** Needs `SEAL_LAUNCHD_UID`. */
export const SEAL_LAUNCHD_LOADED_FUNCTION = `seal_launchd_loaded() { launchctl print ${LAUNCHD_SERVICE_WORD} >/dev/null 2>&1; };`

const LAUNCHD_BOOTOUT_WAIT_TRIES = 50

/** bootout returns before a running instance is gone, and a bootstrap straight after fails with EIO. */
export const SEAL_LAUNCHD_BOOTOUT =
  `${SEAL_LAUNCHD_UID} ${SEAL_LAUNCHD_LOADED_FUNCTION} ` +
  `launchctl bootout ${LAUNCHD_SERVICE_WORD} >/dev/null 2>&1; ` +
  `seal_tries=0; while seal_launchd_loaded && [ "$seal_tries" -lt ${LAUNCHD_BOOTOUT_WAIT_TRIES} ]; ` +
  'do sleep 0.1; seal_tries=$((seal_tries + 1)); done;'

/** Needs `SEAL_LAUNCHD_UID`. The enable clears an earlier `launchctl disable`, which would refuse the bootstrap. */
export const SEAL_LAUNCHD_BOOTSTRAP =
  `launchctl enable ${LAUNCHD_SERVICE_WORD} >/dev/null 2>&1; ` +
  `launchctl bootstrap ${SEAL_LAUNCHD_DOMAIN_WORD} ${SEAL_SERVICE_LAUNCHD_PLIST_WORD}`

/** Any pm2 command spawns the daemon, so liveness is read from its pid file instead. */
export const SEAL_PM2_LIVE_FUNCTION =
  'seal_pm2_live() { seal_pm2_pid=$(cat "${PM2_HOME:-$HOME/.pm2}/pm2.pid" 2>/dev/null) && ' +
  '[ -n "$seal_pm2_pid" ] && kill -0 "$seal_pm2_pid" 2>/dev/null; };'

// Exit 0 only when every app the user's saved list names, other than ours, is in the live list.
const PM2_SAVED_LIST_IS_LIVE = [
  'const saved = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));',
  'let live = "";',
  'process.stdin.on("data", (chunk) => (live += chunk)).on("end", () => {',
  'const names = new Set(JSON.parse(live).map((app) => app.name));',
  `const lost = saved.some((app) => app.name !== "${SEAL_SERVICE_NAME}" && !names.has(app.name));`,
  'process.exit(lost ? 1 : 0); });'
].join(' ')

/** `pm2 save` replaces the saved list with the live one; after a reboot without `pm2 startup` that would drop the user's apps. */
export const SEAL_PM2_SAVE_FUNCTION =
  'seal_pm2_save() { seal_pm2_dump="${PM2_HOME:-$HOME/.pm2}/dump.pm2"; ' +
  '{ [ ! -e "$seal_pm2_dump" ] || pm2 jlist 2>/dev/null | ' +
  `node -e ${quotePosixShell(PM2_SAVED_LIST_IS_LIVE)} "$seal_pm2_dump" 2>/dev/null; } && ` +
  'pm2 save --force >/dev/null 2>&1; :; };'

/** Needs $seal_bin. PM2 maps a signal death to exit 0, so the launch record supervises the runtime and reports it nonzero. */
export function sealPm2StartCommand(): string {
  return [
    `pm2 start ${SEAL_SERVICE_LAUNCHER_WORD} --name ${SEAL_SERVICE_NAME}`,
    // The launcher is sh; PM2 would otherwise load it as Node.
    '--interpreter none',
    // The terminal daemon and its sessions outlive a server restart.
    '--no-treekill',
    // The graceful stop exits 0 and must stay stopped.
    '--stop-exit-codes 0',
    `--kill-timeout ${PM2_KILL_TIMEOUT_MS}`,
    // The server writes its own readiness and log files.
    '--output /dev/null --error /dev/null',
    '--cwd "$seal_bin"'
  ].join(' ')
}

/** Fails when the manager refuses; run after the launch record is in place. PM2 needs $seal_bin. */
export function sealServiceRestartCommand(manager: SealServiceManager): string {
  switch (manager) {
    case 'systemd-user':
      // A unit that hit its start limit stays failed until reset.
      return (
        `${SEAL_SYSTEMD_USER_SESSION} systemctl --user reset-failed ${SEAL_SERVICE_SYSTEMD_UNIT} 2>/dev/null; ` +
        `systemctl --user restart ${SEAL_SERVICE_SYSTEMD_UNIT}`
      )
    case 'launchd':
      // An agent that was booted out since the login is not loaded; RunAtLoad starts it on bootstrap.
      return (
        `${SEAL_LAUNCHD_UID} launchctl kickstart -k ${LAUNCHD_SERVICE_WORD} 2>/dev/null || ` +
        `{ ${SEAL_LAUNCHD_BOOTSTRAP}; }`
      )
    case 'pm2':
      // A fresh daemon has forgotten the entry; the daemon keeps the directory it was spawned in.
      return (
        `${SEAL_PM2_SAVE_FUNCTION} cd "$seal_bin" && ` +
        `{ pm2 restart ${SEAL_SERVICE_NAME} >/dev/null 2>&1 || ${sealPm2StartCommand()} >/dev/null; } && ` +
        'seal_pm2_save'
      )
  }
}

/** Best effort and always exit 0: stops the service and drops what the manager holds. Linger stays. */
export function sealServiceUnregisterCommand(manager: SealServiceManager): string {
  switch (manager) {
    case 'systemd-user':
      return (
        `${SEAL_SYSTEMD_USER_SESSION} ` +
        // Stopped on its own: a disable that fails would skip the stop of `disable --now`.
        `systemctl --user stop ${SEAL_SERVICE_SYSTEMD_UNIT} >/dev/null 2>&1; ` +
        `systemctl --user disable ${SEAL_SERVICE_SYSTEMD_UNIT} >/dev/null 2>&1; ` +
        `rm -f ${SEAL_SERVICE_SYSTEMD_UNIT_WORD} ` +
        `${SEAL_SERVICE_SYSTEMD_UNIT_DIR_WORD}/default.target.wants/${SEAL_SERVICE_SYSTEMD_UNIT}; ` +
        'systemctl --user daemon-reload >/dev/null 2>&1; ' +
        `systemctl --user reset-failed ${SEAL_SERVICE_SYSTEMD_UNIT} >/dev/null 2>&1; :;`
      )
    case 'launchd':
      return `${SEAL_LAUNCHD_BOOTOUT} rm -f ${SEAL_SERVICE_LAUNCHD_PLIST_WORD}; :;`
    case 'pm2':
      // A stopped daemon holds no entry, and asking it would spawn one.
      return (
        `${SEAL_PM2_LIVE_FUNCTION} ${SEAL_PM2_SAVE_FUNCTION} ` +
        `if seal_pm2_live; then pm2 delete ${SEAL_SERVICE_NAME} >/dev/null 2>&1; ` +
        '[ ! -e "${PM2_HOME:-$HOME/.pm2}/dump.pm2" ] || seal_pm2_save; fi; :;'
      )
  }
}
