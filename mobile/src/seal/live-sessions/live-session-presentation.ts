import {
  isActiveLiveSession,
  liveSessionStatusGroup
} from '../../../../src/shared/live-sessions/live-session-status'
import { agentSessionAdapter } from '../../../../src/shared/live-sessions/adapters/agent-session-adapters'
import { isProvisionalLiveSessionId } from '../../../../src/shared/live-sessions/live-session-provisional-id'
import { translate } from '../../i18n/mobile-i18n'
import { liveSessionLabel } from '../../../../src/shared/session-recap/live-session-label'
import type { LiveSession } from './live-session-schemas'

export { liveSessionDotState } from '../../../../src/shared/live-sessions/live-session-status'

export function liveSessionStatusLabel(status: LiveSession['status']): string {
  switch (status) {
    case 'working':
      return translate('seal.liveSessions.status.working', 'Working')
    case 'running-shell':
      return translate('seal.liveSessions.status.runningShell', 'Running shell')
    case 'waiting-subagent':
      return translate('seal.liveSessions.status.waitingSubagent', 'Waiting on subagents')
    case 'waiting-task':
      return translate('seal.liveSessions.status.waitingTask', 'Waiting on background tasks')
    case 'your-turn':
      return translate('seal.liveSessions.status.yourTurn', 'Waiting on you')
    case 'idle':
      return translate('seal.liveSessions.status.idle', 'Idle')
    case 'waiting-input':
      return translate('seal.liveSessions.status.waiting', 'Asking you a question')
    case 'needs-permission':
      return translate('seal.liveSessions.status.permission', 'Waiting for approval')
    case 'errored':
      return translate('seal.liveSessions.status.errored', 'Error')
    case 'done':
      return translate('seal.liveSessions.status.done', 'Ended')
  }
}

export function liveSessionTitle(session: LiveSession): string {
  return liveSessionLabel(session) ?? translate('seal.liveSessions.untitled', 'New session')
}

/** The agent's name from the adapter table; one this build does not know keeps the host's word. */
export function liveSessionProviderLabel(session: Pick<LiveSession, 'provider'>): string {
  return agentSessionAdapter(session.provider)?.label ?? session.provider
}

/** Waiting on the person: a permission prompt, a question, or a failure to look at. */
export function liveSessionNeedsAttention(session: LiveSession): boolean {
  return isActiveLiveSession(session) && liveSessionStatusGroup(session.status) === 'attention'
}

/** No longer running: the default lists leave these out, as desktop's Active agents does. */
export function liveSessionFinished(session: LiveSession): boolean {
  return !isActiveLiveSession(session)
}

/** Seal can type into it: a pane, tmux, Codex's queue, or a headless resume. */
export function liveSessionAcceptsInput(session: LiveSession): boolean {
  // A host from before capabilities says it by listing routes.
  return session.capabilities?.send ?? session.inputRoutes.length > 0
}

/** An external session the agent has named; a made-up id is one Seal can't resume yet. */
export function canTakeOverLiveSession(session: LiveSession): boolean {
  return (
    session.capabilities?.takeOver ??
    (session.origin === 'external' && !isProvisionalLiveSessionId(session.providerSessionId))
  )
}

/** The command that reopens it in a terminal; null where its agent has none. */
export function liveSessionResumeCommand(
  provider: string,
  providerSessionId: string
): string | null {
  return agentSessionAdapter(provider)?.cli?.resumeArgv?.(providerSessionId)?.join(' ') ?? null
}

export function liveTakeOverFailureText(reason: string | undefined, error: string | undefined) {
  switch (reason) {
    case 'not_found':
      return translate('seal.liveSessions.takeOver.notFound', 'That session is no longer listed.')
    case 'not_external':
      return translate(
        'seal.liveSessions.takeOver.notExternal',
        'This session already runs in a Seal pane.'
      )
    case 'not_resumable':
      return translate(
        'seal.liveSessions.takeOver.notResumable',
        'Seal hasn’t seen this session’s transcript yet, so it can’t resume it. Send it a first message, then try again.'
      )
    case 'still_running':
      return translate('seal.liveSessions.takeOver.stillRunning', 'The agent process didn’t stop.')
    case undefined:
    default:
      return error ?? translate('seal.liveSessions.takeOver.failed', 'Something went wrong.')
  }
}
