import { translate } from '@/i18n/i18n'
import type {
  LiveMessage,
  LiveSession,
  LiveSessionStatus
} from '../../../../shared/live-sessions/live-session-types'
import {
  runningBackgroundTasks,
  runningSubagents
} from '../../../../shared/live-sessions/live-session-activity'

export { liveSessionDotState } from '../../../../shared/live-sessions/live-session-status'

export function liveSessionStatusLabel(status: LiveSessionStatus): string {
  switch (status) {
    case 'working':
      return translate('auto.components.live-sessions.status.working', 'Working')
    case 'waiting-subagent':
      return translate(
        'auto.components.live-sessions.status.waitingSubagent',
        'Waiting on subagents'
      )
    case 'waiting-task':
      return translate(
        'auto.components.live-sessions.status.waitingTask',
        'Waiting on background tasks'
      )
    case 'idle':
      return translate('auto.components.live-sessions.status.idle', 'Idle')
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

/** "Waiting on 2 subagents and 1 background task": what a busy-but-quiet session waits on. */
export function liveSessionWaitLabel(session: Pick<LiveSession, 'activity'>): string | null {
  const subagents = runningSubagents(session.activity).length
  const tasks = runningBackgroundTasks(session.activity).length
  const parts = [
    ...(subagents === 1
      ? [translate('auto.components.live-sessions.wait.subagent', '1 subagent')]
      : subagents > 1
        ? [
            translate('auto.components.live-sessions.wait.subagents', '{{count}} subagents', {
              count: subagents
            })
          ]
        : []),
    ...(tasks === 1
      ? [translate('auto.components.live-sessions.wait.task', '1 background task')]
      : tasks > 1
        ? [
            translate('auto.components.live-sessions.wait.tasks', '{{count}} background tasks', {
              count: tasks
            })
          ]
        : [])
  ]
  return parts.length > 0
    ? translate('auto.components.live-sessions.wait.label', 'Waiting on {{what}}', {
        what: parts.join(translate('auto.components.live-sessions.wait.and', ' and '))
      })
    : null
}

/** The status in words, naming what a waiting session waits on. */
export function liveSessionStatusText(session: Pick<LiveSession, 'status' | 'activity'>): string {
  const waiting = session.status === 'waiting-subagent' || session.status === 'waiting-task'
  return (waiting ? liveSessionWaitLabel(session) : null) ?? liveSessionStatusLabel(session.status)
}

export function liveSessionTitle(session: LiveSession): string {
  return (
    session.customTitle ??
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
