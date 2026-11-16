/** Finds the server a user keeps running with `seal serve service install`: Seal installs no second server beside it. */
import {
  SERVE_PROFILE_SUFFIX_HEX_DIGITS,
  serveServiceName,
  type ServeServiceManager
} from '../../../cli/runtime/serve-service-unit'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { isWindowsRemoteHost } from '../../ssh/remote-host/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'
import {
  SEAL_SERVICE_LAUNCHD_AGENTS_DIR_WORD,
  SEAL_SERVICE_SYSTEMD_UNIT_DIR_WORD
} from './seal-service-host-layout'

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

/** Read-only. Null when the host has no `seal serve` service of the user's own; throws when the host did not answer. */
export async function readOwnSealServe(conn: SshConnection): Promise<OwnSealServe | null> {
  const host = await detectRemoteHostPlatform(conn)
  // `seal serve service` exists on Linux and macOS only.
  if (!host || isWindowsRemoteHost(host)) {
    return null
  }
  const output = await execCommand(conn, OWN_SEAL_SERVE_ANSWER, { wrapCommand: true })
  const answer = /^own_serve=(.*)$/mu.exec(output)
  if (!answer) {
    throw new Error('The machine did not answer whether it runs a Seal server of its own.')
  }
  return parseOwnSealServe(answer[1].trim())
}
