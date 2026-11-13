import type { AgentDotState } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import type {
  LiveMessage,
  LiveSession,
  LiveSessionStatus
} from '../../../../shared/live-sessions/live-session-types'

export function liveSessionDotState(status: LiveSessionStatus): AgentDotState {
  switch (status) {
    case 'working':
      return 'working'
    case 'waiting-input':
      return 'waiting'
    case 'needs-permission':
      return 'permission'
    case 'errored':
      return 'failed'
    case 'done':
      return 'done'
  }
}

export function liveSessionStatusLabel(status: LiveSessionStatus): string {
  switch (status) {
    case 'working':
      return translate('auto.components.live-sessions.status.working', 'Working')
    case 'waiting-input':
      return translate('auto.components.live-sessions.status.waiting', 'Waiting for input')
    case 'needs-permission':
      return translate('auto.components.live-sessions.status.permission', 'Needs permission')
    case 'errored':
      return translate('auto.components.live-sessions.status.errored', 'Errored')
    case 'done':
      return translate('auto.components.live-sessions.status.done', 'Done')
  }
}

export function liveSessionTitle(session: LiveSession): string {
  return (
    session.title ??
    session.project ??
    translate('auto.components.live-sessions.untitled', 'New session')
  )
}

export function liveSessionProviderLabel(session: LiveSession): string {
  return session.provider === 'claude' ? 'Claude Code' : 'Codex'
}

/** Copy for a message still on its way; never claims the agent read it before the transcript does. */
export function liveMessageStateLabel(message: LiveMessage): string {
  switch (message.state) {
    case 'queued':
      return translate('auto.components.live-sessions.message.queued', 'Waiting to send')
    case 'sending':
      return translate('auto.components.live-sessions.message.sending', 'Sending')
    case 'sent':
      return translate(
        'auto.components.live-sessions.message.sent',
        'Sent, waiting for the session'
      )
    case 'delivered':
      return translate('auto.components.live-sessions.message.delivered', 'Delivered')
    case 'failed':
      return (
        message.error ?? translate('auto.components.live-sessions.message.failed', 'Not delivered')
      )
  }
}

export type MachineGroup = { hostId: string; label: string; sessions: LiveSession[] }

/** This machine first, then SSH hosts by name; sessions keep their most-recent-first order. */
export function groupByMachine(sessions: readonly LiveSession[]): MachineGroup[] {
  const groups = new Map<string, MachineGroup>()
  for (const session of sessions) {
    const group = groups.get(session.machine.hostId) ?? {
      hostId: session.machine.hostId,
      label: session.machine.label,
      sessions: []
    }
    group.sessions.push(session)
    groups.set(session.machine.hostId, group)
  }
  const kindOf = (g: MachineGroup) => g.sessions[0].machine.kind
  return [...groups.values()].sort((a, b) =>
    kindOf(a) === kindOf(b) ? a.label.localeCompare(b.label) : kindOf(a) === 'local' ? -1 : 1
  )
}
