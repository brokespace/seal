/** Finds the server a user keeps running with `seal serve service install`: Seal installs no second server beside it. */
import {
  SERVE_PROFILE_SUFFIX_HEX_DIGITS,
  serveServiceName,
  type ServeServiceManager
} from '../../../cli/runtime/serve-service-unit'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'
import type { RemoteInstallTransport } from '../install/remote-install-transport'
import {
  SEAL_SERVICE_LAUNCHD_AGENTS_DIR_WORD,
  SEAL_SERVICE_SYSTEMD_UNIT_DIR_WORD
} from './seal-service-host-layout'
import { SEAL_LAUNCHD_UID, SEAL_SYSTEMD_USER_SESSION } from './seal-service-manager-commands'

export type OwnSealServe = {
  manager: 'systemd-user' | 'launchd'
  /** The unit name with `.service`, or the launchd label. */
  name: string
}

type UnitFileKind = {
  manager: OwnSealServe['manager']
  namedBy: ServeServiceManager
  uname: string
  directoryWord: string
  extension: string
}

const UNIT_FILE_KINDS: readonly UnitFileKind[] = [
  {
    manager: 'systemd-user',
    namedBy: 'systemd',
    uname: 'Linux',
    directoryWord: SEAL_SERVICE_SYSTEMD_UNIT_DIR_WORD,
    extension: ''
  },
  {
    manager: 'launchd',
    namedBy: 'launchd',
    uname: 'Darwin',
    directoryWord: SEAL_SERVICE_LAUNCHD_AGENTS_DIR_WORD,
    extension: '.plist'
  }
]

const PROFILE_SUFFIX_GLOB = '[0-9a-f]'.repeat(SERVE_PROFILE_SUFFIX_HEX_DIGITS)
const PROFILE_SUFFIX = new RegExp(`^[0-9a-f]{${SERVE_PROFILE_SUFFIX_HEX_DIGITS}}$`, 'u')

// Exact names only: Seal's own `com.brokespace.seal.server` and the browser helper's label start with the serve label.
function unitFileWords(kind: UnitFileKind): string {
  return ['', PROFILE_SUFFIX_GLOB]
    .map(
      (suffix) => `${kind.directoryWord}/${serveServiceName(kind.namedBy, suffix)}${kind.extension}`
    )
    .join(' ')
}

/** Answers `own_serve=` with the unit file's path, or with nothing. The file existing is what the CLI calls installed. */
export const OWN_SEAL_SERVE_ANSWER = [
  'seal_own_serve() { for seal_file in "$@"; do',
  '[ ! -e "$seal_file" ] || { echo "own_serve=$seal_file"; return 0; }; done; echo own_serve=; };',
  'case "$(uname -s 2>/dev/null)" in',
  ...UNIT_FILE_KINDS.map((kind) => `${kind.uname}) seal_own_serve ${unitFileWords(kind)};;`),
  '*) seal_own_serve;; esac;'
].join(' ')

function isServeServiceName(namedBy: ServeServiceManager, name: string): boolean {
  if (name === serveServiceName(namedBy, '')) {
    return true
  }
  const [before, after] = serveServiceName(namedBy, '\0').split('\0')
  return (
    name.startsWith(before) &&
    name.endsWith(after) &&
    PROFILE_SUFFIX.test(name.slice(before.length, name.length - after.length))
  )
}

export function parseOwnSealServe(unitFile: string | undefined): OwnSealServe | null {
  const file = unitFile?.slice(unitFile.lastIndexOf('/') + 1) ?? ''
  for (const kind of UNIT_FILE_KINDS) {
    const name = file.slice(0, file.length - kind.extension.length)
    if (file.endsWith(kind.extension) && isServeServiceName(kind.namedBy, name)) {
      return { manager: kind.manager, name }
    }
  }
  return null
}

/** False for Windows and for a platform Seal does not support; a known `host` skips the detection. */
export async function isPosixHost(
  conn: RemoteInstallTransport,
  options: { host?: RemoteHostPlatform; signal?: AbortSignal } = {}
): Promise<boolean> {
  const host = options.host ?? (await detectRemoteHostPlatform(conn, { signal: options.signal }))
  return host !== null && !isWindowsRemoteHost(host)
}

/** Read-only. Null when the host has no `seal serve` service of the user's own; throws when the host did not answer. */
export async function readOwnSealServe(conn: SshConnection): Promise<OwnSealServe | null> {
  // `seal serve service` exists on Linux and macOS only.
  if (!(await isPosixHost(conn))) {
    return null
  }
  const output = await execCommand(conn, OWN_SEAL_SERVE_ANSWER, { wrapCommand: true })
  const answer = /^own_serve=(.*)$/mu.exec(output)
  if (!answer) {
    throw new Error('The machine did not answer whether it runs a Seal server of its own.')
  }
  return parseOwnSealServe(answer[1].trim())
}

// launchctl exits with this when the domain holds no such service.
const LAUNCHD_NOT_LOADED_EXIT = 113
const LAUNCHD_NOT_LOADED = 'not-loaded'
const SYSTEMD_STOPPED_STATES: ReadonlySet<string> = new Set(['inactive', 'failed', 'deactivating'])

/** Answers `own_serve_state=` with the manager's word for the service, or with nothing when the manager did not say. Read-only. */
export function ownSealServeStateCommand(serve: OwnSealServe): string {
  if (serve.manager === 'systemd-user') {
    return `${SEAL_SYSTEMD_USER_SESSION} echo "own_serve_state=$(systemctl --user is-active ${serve.name} 2>/dev/null)"`
  }
  return [
    SEAL_LAUNCHD_UID,
    `seal_agent=$(launchctl print "gui/$seal_uid/${serve.name}" 2>/dev/null);`,
    'case $? in',
    '0) echo "own_serve_state=$(printf \'%s\\n\' "$seal_agent" | sed -n \'s/^[[:space:]]*state = //p\' | head -n 1)";;',
    `${LAUNCHD_NOT_LOADED_EXIT}) echo own_serve_state=${LAUNCHD_NOT_LOADED};;`,
    '*) echo own_serve_state=;; esac'
  ].join(' ')
}

/** The command that starts a service that is not running; null when it runs, or when its manager did not say. */
export function parseOwnSealServeStartCommand(serve: OwnSealServe, output: string): string | null {
  const state = /^own_serve_state=(.*)$/mu.exec(output)?.[1].trim()
  if (!state) {
    return null
  }
  if (serve.manager === 'systemd-user') {
    return SYSTEMD_STOPPED_STATES.has(state) ? `systemctl --user start ${serve.name}` : null
  }
  if (state === 'running') {
    return null
  }
  // An agent that was booted out has to be loaded again; RunAtLoad then starts it.
  return state === LAUNCHD_NOT_LOADED
    ? `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${serve.name}.plist`
    : `launchctl kickstart gui/$(id -u)/${serve.name}`
}

/** Read-only. Asked only after the server did not answer, so a server that answers costs no round trip. */
export async function readOwnSealServeStartCommand(
  conn: SshConnection,
  serve: OwnSealServe
): Promise<string | null> {
  const output = await execCommand(conn, ownSealServeStateCommand(serve), { wrapCommand: true })
  return parseOwnSealServeStartCommand(serve, output)
}
