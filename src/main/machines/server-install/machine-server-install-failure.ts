/** Why a Seal server install failed, as a fragment that reads after "Seal server is not installed: ". */
import { sshHostServerSetupRemedy } from '../../../shared/ssh-host-server-setup-remedy'
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
const READ_ONLY_HOME = 'the home folder is read-only'
const UNWRITABLE_HOME = 'the machine refused to write the server files (permission denied)'
const DOWNLOAD_BLOCKED = 'the runtime download was blocked on this computer and on the machine'
const PAIRING_FAILED = 'pairing with the server failed'
const CONTACT_LOST = 'the connection to the machine was lost during the install'
const MAX_REASON_CHARS = 200

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
  [/\bpairing\b/i, PAIRING_FAILED]
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
    return errorReason(failure) ?? hostPhraseReason(failure.message) ?? fragment(failure.message)
  }
  return fragment(String(failure))
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
    return unavailableReason(decision.detail) ?? fragment(unservedHostServerMessage(decision))
  }
  if (decision.code && sshHostServerSetupRemedy(decision.code) === 'free-host-space') {
    return NO_SPACE
  }
  const detail =
    decision.reason === 'failed' || decision.reason === 'deferred' || decision.reason === 'refused'
      ? decision.detail
      : undefined
  return (
    (detail && hostPhraseReason(detail)) || fragment(detail || unservedHostServerMessage(decision))
  )
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

/** The first sentence of a longer message, without its full stop. */
function fragment(text: string): string {
  const line = text.trim().split(/\r?\n/u)[0] ?? ''
  const sentence = (line.split(/(?<=[.!?])\s+/u)[0] ?? line).replace(/[.\s]+$/u, '')
  const reason = sentence || 'the install did not finish'
  return reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS - 1)}…` : reason
}
