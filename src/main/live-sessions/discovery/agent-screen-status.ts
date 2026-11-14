// What an agent's visible terminal screen changes about the status its transcript and processes gave.
import { createHash } from 'node:crypto'
import {
  isRestingLiveSessionStatus,
  liveSessionStatusGroup
} from '../../../shared/live-sessions/live-session-status'
import type {
  LiveSession,
  LiveSessionStatus,
  LiveSessionStatusSource
} from '../../../shared/live-sessions/live-session-types'
import type { AgentScreen } from './agent-screen'
import type { TranscriptSummary } from './transcript-summary'

type Read = {
  status: LiveSessionStatus
  statusSource: LiveSessionStatusSource
  statusDetail: string | null
}

export function permissionPromptId(paneId: string, screen: AgentScreen): string {
  const approval = screen.approval!
  const facts = [paneId, approval.question, ...approval.options.map((o) => o.label)]
  return createHash('sha256').update(facts.join('\n')).digest('hex').slice(0, 16)
}

/** The status of a running agent, given what its pane shows right now. */
export function withAgentScreen(
  current: Read,
  shown: { screen: AgentScreen; paneId: string; summary: TranscriptSummary | undefined }
): Read & { permission: LiveSession['permission'] } {
  const { screen, summary } = shown
  if (screen.approval) {
    const { question, options } = screen.approval
    return {
      status: 'needs-permission',
      statusSource: 'screen',
      // "Do you want to proceed?" says less than the call the prompt holds.
      statusDetail:
        summary?.phase === 'tool-pending' && summary.detail ? `Allow ${summary.detail}?` : question,
      permission:
        options.length > 0
          ? {
              promptId: permissionPromptId(shown.paneId, screen),
              question,
              options: options.map(({ id, label }) => ({ id, label }))
            }
          : null
    }
  }
  if (screen.dialog && liveSessionStatusGroup(current.status) === 'working') {
    // A turn cannot go on under a dialog: it waits for the user's choice in the terminal.
    return {
      status: 'needs-permission',
      statusSource: 'screen',
      statusDetail: screen.dialog,
      permission: null
    }
  }
  if (current.status === 'needs-permission' && screen.promptBox) {
    // The dialog is gone from the screen: whatever asked has been answered.
    return { ...current, status: 'working', statusSource: 'screen', permission: null }
  }
  const resting =
    isRestingLiveSessionStatus(current.status) ||
    (current.status === 'waiting-input' && summary?.phase === 'turn-ended')
  if (screen.busy && current.statusSource === 'transcript' && resting) {
    // The agent shows its interrupt hint: a turn runs that the transcript has not recorded yet.
    return { ...current, status: 'working', statusSource: 'screen', permission: null }
  }
  return { ...current, permission: null }
}
