/** Why a Seal server install failed, as a fragment that reads after "Seal server is not installed: ". */
import { sshHostServerSetupRemedy } from '../../../shared/ssh-host-server-setup-remedy'
import { escapeRegex } from '../../../shared/string-utils'
import { RELAY_REMOTE_DIR } from '../../managed-server/install/remote-install-root'
import {
  classifyOrcadHostUnavailable,
  ORCAD_TUNNEL_UNAVAILABLE_REASON,
  type OrcadHostUnavailableReason
} from '../../orcad/diagnostics/orcad-host-unavailable'
import { isCancelledConnectAttemptError } from '../../ssh/connection/reconnect/ssh-connect-attempt-cancellation'
import { isSshSessionStartFailure } from '../../ssh/connection/ssh-session-start-failure'
import type { HostServerOnConnectResult } from '../../ssh/host-server/ssh-host-server-on-connect'
import { unservedHostServerMessage } from '../../ssh/host-server/ssh-host-unserved-status'
import { quitTeardownStartGate } from '../../startup/quit/quit-teardown-start-gate'

type UnservedDecision = Extract<HostServerOnConnectResult, { route: 'unserved' }>

const NO_SPACE = 'no space left on device'
const READ_ONLY_HOME = 'the folder for the server files is read-only'
const UNWRITABLE_HOME = 'the machine refused to write the server files (permission denied)'
const DOWNLOAD_BLOCKED = 'the runtime download was blocked on this computer and on the machine'
const PAIRING_FAILED = 'pairing with the server failed'
const CONTACT_LOST = 'the connection to the machine was lost during the install'
const NEVER_STARTED = 'the server did not start on this machine'
const OTHER_SERVER_RUNNING =
  'another Seal or Orca server is already running in this account on the machine; stop it, then try again'
const HOST_BUSY = 'an earlier install on this machine was interrupted or is still running'
const SERVER_FOLDER_IS_A_FILE = `~/${RELAY_REMOTE_DIR} on the machine is a file, not a folder, so Seal cannot put its server there. Move or delete that file, then try again`
const COMMAND_FAILED = 'the install command failed on the machine'
const COMMAND_TIMED_OUT = 'the machine did not finish the install command in time'
const DID_NOT_FINISH = 'the install did not finish'
const MAX_REASON_CHARS = 200
const MAX_HOST_LINE_CHARS = 120

// `mkdir -p` names the folder itself when it is a file; a path below it fails with "Not a directory".
const SERVER_FOLDER_IS_A_FILE_PHRASE = new RegExp(
  `${escapeRegex(RELAY_REMOTE_DIR)}(?:[’'"]?: file exists|\\b[^\\s:]*: not a directory)`,
  'i'
)

// A failed remote command is worded `Command "<command line>" failed (exit N): <what the host printed>`.
const COMMAND_EXIT = /^[\s\S]*" failed \(exit \d+\):/u
const COMMAND_TIMEOUT = /" timed out after [\d.]+s\b/u

// Shells say `sh: 1: tar: not found`, `bash: line 1: tar: command not found` or `zsh:1: command not found: tar`.
const MISSING_PROGRAM =
  /(?<![\w./+-])([A-Za-z_][\w.+-]*): (?:command )?not found\b|\bcommand not found: ([\w.+-]+)/u

const INTERNAL_NAME = /orcad|orca_/iu
// Markers the install commands print for Seal, and shell syntax, are not the host's words.
const NOT_PROSE = /[A-Z0-9]_[A-Z0-9]|[$`{}|;\\]|&&/u

// Another desktop, or an install that was cut short, holds the host for a while.
const HOST_BUSY_CODES: ReadonlySet<string> = new Set([
  'orcad_activation_fence_busy',
  'orcad_recovery_transaction_still_fresh'
])
// A decision carries a thrown setup error only as its message, so the lock's own words are matched too.
const HOST_BUSY_PHRASE =
  /another run is changing this host|activation fence is held|could not acquire the install lock/i
const INSTALL_LOCK_BUSY_ERROR = 'RemoteInstallLockBusyError'

const REASONS_BY_DECISION_CODE: Record<string, string> = {
  orcad_activation_no_readiness: NEVER_STARTED,
  orcad_initial_runtime_live: OTHER_SERVER_RUNNING
}

const UNAVAILABLE_REASONS: Record<OrcadHostUnavailableReason, string> = {
  unsupported_host: 'the platform or architecture of this machine is not supported',
  libc_unidentified: 'the C library of this machine could not be identified',
  windows_build_unsupported: 'this machine runs a version of Windows that is too old',
  artifacts_unavailable: 'this copy of Seal does not include the server files',
  runtime_self_test: 'the server runtime does not run on this machine',
  runtime_noexec: 'the home folder does not allow running programs (it is mounted noexec)',
  windows_no_extractor: 'the machine has neither tar nor PowerShell to unpack the server',
  security_software: 'security software on the machine changed the server runtime',
  native_preflight: 'the server failed its start-up check on this machine',
  [ORCAD_TUNNEL_UNAVAILABLE_REASON]: 'the machine does not allow SSH port forwarding'
}

const REASONS_BY_ERROR_NAME: Record<string, string> = {
  RemoteInstallOutOfSpaceError: NO_SPACE,
  NodeRuntimeUnreachableError: DOWNLOAD_BLOCKED,
  OrcadManagedPairingRejectedError: PAIRING_FAILED,
  OrcadManagedPairingRepairFailedError: PAIRING_FAILED,
  SshChannelOpenTimeoutError: CONTACT_LOST
}

const REASONS_BY_ERRNO: Record<string, string> = {
  ENOSPC: NO_SPACE,
  EDQUOT: NO_SPACE,
  EROFS: READ_ONLY_HOME,
  EACCES: UNWRITABLE_HOME,
  EPERM: UNWRITABLE_HOME
}

// A decision carries a thrown setup error only as its message, so the host's own words are all that is left.
const HOST_ERROR_PHRASES: readonly (readonly [RegExp, string])[] = [
  [
    /no space left on device|disk quota exceeded|out of disk space|\bENOSPC\b|\bEDQUOT\b/i,
    NO_SPACE
  ],
  [/read-only file system|\bEROFS\b/i, READ_ONLY_HOME],
  [/permission denied|\bEACCES\b/i, UNWRITABLE_HOME],
  [SERVER_FOLDER_IS_A_FILE_PHRASE, SERVER_FOLDER_IS_A_FILE],
  [/\bpairing\b/i, PAIRING_FAILED],
  [/never published an .?orca_server_ready/i, NEVER_STARTED],
  [/unmanaged runtime owner is still live/i, OTHER_SERVER_RUNNING]
]

function isUnservedDecision(failure: unknown): failure is UnservedDecision {
  return (
    typeof failure === 'object' &&
    failure !== null &&
    'route' in failure &&
    failure.route === 'unserved'
  )
}

/** True when a plain SSH connect would end the same way, so the connect keeps its own error. */
export function repeatsOverPlainSsh(failure: unknown): boolean {
  if (quitTeardownStartGate.hasStarted()) {
    return true
  }
  if (!(failure instanceof Error)) {
    return false
  }
  return (
    isSshSessionStartFailure(failure) ||
    isCancelledConnectAttemptError(failure) ||
    ('code' in failure && failure.code === 'ssh_user_disconnected') ||
    ('level' in failure && failure.level === 'client-authentication')
  )
}

/** Set when the move was refused only for saved items the user may leave on this computer. */
export function blockedServerMove(failure: unknown): { detail: string | null } | null {
  return isUnservedDecision(failure) && failure.canLeaveBehind
    ? { detail: failure.detail ?? null }
    : null
}

/** True when the host only has to finish another install first, so trying again is all it takes. */
export function hostIsBusyWithAnotherInstall(failure: unknown): boolean {
  if (isUnservedDecision(failure)) {
    return (
      (failure.code !== undefined && HOST_BUSY_CODES.has(failure.code)) ||
      (failure.detail !== undefined && HOST_BUSY_PHRASE.test(failure.detail))
    )
  }
  return (
    failure instanceof Error &&
    (failure.name === INSTALL_LOCK_BUSY_ERROR || HOST_BUSY_PHRASE.test(failure.message))
  )
}

/** Why an install waits for another one, and when Seal tries it again. */
export function busyHostReason(retriesSoon: boolean): string {
  return retriesSoon
    ? `${HOST_BUSY}, and Seal tries again in a moment`
    : `${HOST_BUSY}, and Seal tries again the next time it connects`
}

/** Set when the move only waits for terminals to end, so a later connect finishes the install. */
export function deferredServerInstallReason(failure: unknown): string | null {
  if (!isUnservedDecision(failure)) {
    return null
  }
  const finishes = 'and the install will finish when these terminals are closed'
  if (failure.reason === 'relay_terminals_unverifiable') {
    return `Seal could not confirm that the terminals on this machine have exited, ${finishes}`
  }
  if (failure.reason !== 'relay_terminals_live') {
    return null
  }
  const count = failure.terminals ?? 0
  if (count === 1) {
    return '1 terminal is still running on this machine, and the install will finish when this terminal is closed'
  }
  const terminals = count > 1 ? `${count} terminals` : 'terminals'
  return `${terminals} are still running on this machine, ${finishes}`
}

export function serverInstallFailureReason(failure: unknown): string {
  if (isUnservedDecision(failure)) {
    return decisionReason(failure)
  }
  if (failure instanceof Error) {
    return errorReason(failure) ?? messageReason(failure.message)
  }
  return messageReason(String(failure))
}

function decisionReason(decision: UnservedDecision): string {
  if (decision.nodeDownloadBlocked) {
    return DOWNLOAD_BLOCKED
  }
  if (decision.contactLost) {
    return CONTACT_LOST
  }
  if (decision.held) {
    return 'moving the projects of this machine to its server was interrupted'
  }
  if (decision.reason === 'orcad_unavailable') {
    return unavailableReason(decision.detail) ?? statedReason(unservedHostServerMessage(decision))
  }
  if (decision.code && sshHostServerSetupRemedy(decision.code) === 'free-host-space') {
    return NO_SPACE
  }
  if (decision.code && Object.hasOwn(REASONS_BY_DECISION_CODE, decision.code)) {
    return REASONS_BY_DECISION_CODE[decision.code]
  }
  const detail =
    decision.reason === 'failed' || decision.reason === 'deferred' || decision.reason === 'refused'
      ? decision.detail
      : undefined
  return detail ? messageReason(detail) : statedReason(unservedHostServerMessage(decision))
}

function unavailableReason(detail: string | undefined): string | null {
  const reasons: Record<string, string> = UNAVAILABLE_REASONS
  return detail && Object.hasOwn(reasons, detail) ? reasons[detail] : null
}

function errorReason(error: Error, depth = 0): string | null {
  const unavailable = classifyOrcadHostUnavailable(error)
  const errno = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const known =
    (unavailable && UNAVAILABLE_REASONS[unavailable]) ||
    REASONS_BY_ERROR_NAME[error.name] ||
    REASONS_BY_ERRNO[errno]
  if (known) {
    return known
  }
  return depth < 4 && error.cause instanceof Error ? errorReason(error.cause, depth + 1) : null
}

function hostPhraseReason(text: string): string | null {
  return HOST_ERROR_PHRASES.find(([phrase]) => phrase.test(text))?.[1] ?? null
}

/** A failed command's message holds its whole command line, so only what the host printed is read. */
function messageReason(message: string): string {
  const exit = COMMAND_EXIT.exec(message)
  if (!exit) {
    return COMMAND_TIMEOUT.test(message)
      ? COMMAND_TIMED_OUT
      : (hostPhraseReason(message) ?? statedReason(message))
  }
  const printed = message.slice(exit[0].length)
  return hostPhraseReason(printed) ?? hostLineReason(printed) ?? COMMAND_FAILED
}

/** The last thing the host said in words: stderr comes before the markers a command prints for Seal. */
function hostLineReason(printed: string): string | null {
  const line = printed
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .findLast(
      (candidate) =>
        candidate.length <= MAX_HOST_LINE_CHARS &&
        /\p{L}{3}/u.test(candidate) &&
        /\s/u.test(candidate) &&
        !INTERNAL_NAME.test(candidate) &&
        !NOT_PROSE.test(candidate)
    )
  if (!line) {
    return null
  }
  const missing = MISSING_PROGRAM.exec(line)
  const program = missing?.[1] ?? missing?.[2]
  if (!program) {
    return `the machine reported “${line.replace(/[.\s]+$/u, '')}”`
  }
  const purpose = program === 'tar' ? 'unpack' : 'install'
  return `the machine has no “${program}” program, which Seal needs to ${purpose} its server. Install ${program} there, then try again`
}

/** The first sentence of a longer message, without its full stop; never one that names Seal's internals. */
function statedReason(text: string): string {
  const line = text.trim().split(/\r?\n/u)[0] ?? ''
  const sentence = (line.split(/(?<=[.!?])\s+/u)[0] ?? line).replace(/[.\s]+$/u, '')
  if (!sentence || INTERNAL_NAME.test(sentence)) {
    return DID_NOT_FINISH
  }
  return sentence.length > MAX_REASON_CHARS
    ? `${sentence.slice(0, MAX_REASON_CHARS - 1)}…`
    : sentence
}
