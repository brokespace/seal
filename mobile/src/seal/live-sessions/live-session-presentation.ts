import {
  isActiveLiveSession,
  liveSessionStatusGroup
} from '../../../../src/shared/live-sessions/live-session-status'
import { groupLiveSessionsByMachine } from '../../../../src/shared/live-sessions/live-session-summary'
import { translate } from '../../i18n/mobile-i18n'
import type { LiveMessage, LiveSession } from './live-session-schemas'

export { liveSessionDotState } from '../../../../src/shared/live-sessions/live-session-status'

export function liveSessionStatusLabel(status: LiveSession['status']): string {
  switch (status) {
    case 'working':
      return translate('seal.liveSessions.status.working', 'Working')
    case 'waiting-subagent':
      return translate('seal.liveSessions.status.waitingSubagent', 'Waiting on subagents')
    case 'waiting-task':
      return translate('seal.liveSessions.status.waitingTask', 'Waiting on background tasks')
    case 'idle':
      return translate('seal.liveSessions.status.idle', 'Idle')
    case 'waiting-input':
      return translate('seal.liveSessions.status.waiting', 'Waiting for input')
    case 'needs-permission':
      return translate('seal.liveSessions.status.permission', 'Needs permission')
    case 'errored':
      return translate('seal.liveSessions.status.errored', 'Errored')
    case 'done':
      return translate('seal.liveSessions.status.done', 'Done')
  }
}

export function liveSessionTitle(session: LiveSession): string {
  return session.title ?? session.project ?? translate('seal.liveSessions.untitled', 'New session')
}

export function liveSessionProviderLabel(session: Pick<LiveSession, 'provider'>): string {
  switch (session.provider) {
    case 'claude':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
    default:
      return session.provider
  }
}

/** Waiting on the person: a permission prompt, a question, or a failure to look at. */
export function liveSessionNeedsAttention(session: LiveSession): boolean {
  return isActiveLiveSession(session) && liveSessionStatusGroup(session.status) === 'attention'
}

/** Copy for a message still on its way; never claims the agent read it before the transcript does. */
export function liveMessageStateLabel(message: LiveMessage): string {
  switch (message.state) {
    case 'queued':
      return translate('seal.liveSessions.message.queued', 'Waiting to send')
    case 'sending':
      return translate('seal.liveSessions.message.sending', 'Sending')
    case 'sent':
      return translate('seal.liveSessions.message.sent', 'Sent, waiting for the session')
    case 'delivered':
      return translate('seal.liveSessions.message.delivered', 'Delivered')
    case 'failed':
      return message.error ?? translate('seal.liveSessions.message.failed', 'Not delivered')
  }
}

/** No longer running: the default lists leave these out, as desktop's Active agents does. */
export function liveSessionFinished(session: LiveSession): boolean {
  return !isActiveLiveSession(session)
}

/** Seal can type into it: a pane, tmux, Codex's queue, or a headless resume. */
export function liveSessionAcceptsInput(session: LiveSession): boolean {
  return session.inputRoutes.length > 0
}

/** External sessions with a real transcript id; a `pid-` id is a process Seal hasn't matched yet. */
export function canTakeOverLiveSession(session: LiveSession): boolean {
  return session.origin === 'external' && !session.providerSessionId.startsWith('pid-')
}

export function liveSessionResumeCommand(provider: string, providerSessionId: string): string {
  return provider === 'codex'
    ? `codex resume ${providerSessionId}`
    : `claude --resume ${providerSessionId}`
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

export type LiveProjectGroup = { key: string; label: string; sessions: LiveSession[] }
export type LiveMachineGroup = {
  hostId: string
  label: string
  kind: LiveSession['machine']['kind']
  projects: LiveProjectGroup[]
}

/** Machines and session order as desktop's Active agents; each machine's sessions under their project. */
export function groupLiveSessions(sessions: readonly LiveSession[]): LiveMachineGroup[] {
  return groupLiveSessionsByMachine(sessions).map((machine) => {
    const projects: LiveProjectGroup[] = []
    for (const session of machine.sessions) {
      const key = session.cwd ?? session.project ?? ''
      let project = projects.find((entry) => entry.key === key)
      if (!project) {
        project = {
          key,
          label:
            session.project ??
            session.cwd ??
            translate('seal.liveSessions.noProject', 'No project folder'),
          sessions: []
        }
        projects.push(project)
      }
      project.sessions.push(session)
    }
    return { hostId: machine.hostId, label: machine.label, kind: machine.kind, projects }
  })
}
