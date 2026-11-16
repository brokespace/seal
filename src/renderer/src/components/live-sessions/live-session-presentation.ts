import { translate } from '@/i18n/i18n'
import type {
  LiveMessage,
  LiveSession,
  LiveSessionStatus
} from '../../../../shared/live-sessions/live-session-types'
import { liveSessionLabel } from '../../../../shared/session-recap/live-session-label'
import {
  runningBackgroundTasks,
  runningSubagents
} from '../../../../shared/live-sessions/live-session-activity'

import { isWaitingOnBackgroundWork } from '../../../../shared/live-sessions/live-session-status'

export { liveSessionDotState } from '../../../../shared/live-sessions/live-session-status'

export function liveSessionStatusLabel(status: LiveSessionStatus): string {
  switch (status) {
    case 'working':
      return translate('auto.components.live-sessions.status.working', 'Working')
    case 'running-shell':
      return translate('auto.components.live-sessions.status.runningShell', 'Running shell')
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
    case 'your-turn':
      return translate('auto.components.live-sessions.status.yourTurn', 'Waiting on you')
    case 'idle':
      return translate('auto.components.live-sessions.status.idle', 'Idle')
    case 'waiting-input':
      return translate('auto.components.live-sessions.status.waiting', 'Asking you a question')
    case 'needs-permission':
      return translate('auto.components.live-sessions.status.permission', 'Waiting for approval')
    case 'errored':
      return translate('auto.components.live-sessions.status.errored', 'Error')
    case 'done':
      return translate('auto.components.live-sessions.status.done', 'Ended')
  }
}

function subagentCount(session: Pick<LiveSession, 'activity'>): string | null {
  const subagents = runningSubagents(session.activity).length
  if (subagents === 0) {
    return null
  }
  return subagents === 1
    ? translate('auto.components.live-sessions.wait.subagent', '1 subagent')
    : translate('auto.components.live-sessions.wait.subagents', '{{count}} subagents', {
        count: subagents
      })
}

function backgroundTaskCount(session: Pick<LiveSession, 'activity'>): string | null {
  const tasks = runningBackgroundTasks(session.activity).length
  if (tasks === 0) {
    return null
  }
  return tasks === 1
    ? translate('auto.components.live-sessions.wait.task', '1 background task')
    : translate('auto.components.live-sessions.wait.tasks', '{{count}} background tasks', {
        count: tasks
      })
}

/** "Waiting on 2 subagents", "Waiting on 1 background task": what a waiting session is blocked on. */
export function liveSessionWaitLabel(
  session: Pick<LiveSession, 'status' | 'activity'>
): string | null {
  const what =
    session.status === 'waiting-task' ? backgroundTaskCount(session) : subagentCount(session)
  return what
    ? translate('auto.components.live-sessions.wait.label', 'Waiting on {{what}}', { what })
    : null
}

/** "2 background tasks still running": what the session left running, which it does not wait on. */
export function liveSessionLeftoverLabel(session: Pick<LiveSession, 'activity'>): string | null {
  const what = backgroundTaskCount(session)
  return what
    ? translate('auto.components.live-sessions.wait.stillRunning', '{{what}} still running', {
        what
      })
    : null
}

/** The status in words, naming what a waiting session waits on. */
export function liveSessionStatusText(session: Pick<LiveSession, 'status' | 'activity'>): string {
  const waiting = isWaitingOnBackgroundWork(session.status)
  return (waiting ? liveSessionWaitLabel(session) : null) ?? liveSessionStatusLabel(session.status)
}

export function liveSessionTitle(session: LiveSession): string {
  return (
    liveSessionLabel(session) ?? translate('auto.components.live-sessions.untitled', 'New session')
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
