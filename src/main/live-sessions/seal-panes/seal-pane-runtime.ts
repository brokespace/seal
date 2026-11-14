import type { AgentStatusIpcPayload } from '../../../shared/agent-status/contracts/agent-status-ipc-payload'
import type { PendingPrompt } from '../../../shared/agent-status/contracts/agent-pending-prompt'
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { TerminalAgentPromptAnswers } from '../../runtime/terminal/input/terminal-agent-prompt-answer'
import { createLaunchedAgentWriteGuard } from '../../runtime/terminal/wait/launched-agent-write-guard'
import { bindPane, deliverFollowUp } from '../../external-conversations/external-conversation-send'
import type { SealPaneInput } from '../delivery/session-input-routes'
import { sealPanesFromRows, type SealPane } from './seal-pane-sessions'

export type SealPaneHookRows = {
  snapshot(): AgentStatusIpcPayload[]
}

/** Seal panes reuse Orca's own pane writer: it waits through approvals and fences replaced processes. */
export function createSealPaneAccess(runtime: OrcaRuntimeService, rows: SealPaneHookRows) {
  const readHookRow = (paneKey: string) => runtime.agentTransitions.latestRow(paneKey)
  const answers = new TerminalAgentPromptAnswers(readHookRow)
  const target = (paneKey: string, agent: LiveSessionProvider) => ({
    paneKey,
    agent,
    answerable: true
  })

  const pendingPrompt = (paneKey: string, agent: LiveSessionProvider): PendingPrompt | null => {
    try {
      return answers.pending(runtime, target(paneKey, agent))
    } catch {
      return null
    }
  }

  const panes = (): SealPane[] => {
    const latest = new Map<string, AgentStatusIpcPayload>()
    for (const row of rows.snapshot()) {
      const had = latest.get(row.paneKey)
      if (!row.providerSessionOnly && (!had || row.receivedAt > had.receivedAt)) {
        latest.set(row.paneKey, row)
      }
    }
    return sealPanesFromRows([...latest.values()], pendingPrompt)
  }

  const input: SealPaneInput = {
    async send(paneKey, agent, text, requestId, signal) {
      const bound = bindPane(runtime, paneKey)
      if (!bound) {
        return { outcome: 'unavailable', reason: 'The Seal pane is closed' }
      }
      const delivery = await deliverFollowUp(runtime, {
        handle: bound.handle,
        expectedBinding: bound.binding,
        agent,
        text,
        requestId,
        signal
      })
      if (delivery.outcome === 'refused') {
        return { outcome: 'unavailable', reason: `The Seal pane refused it (${delivery.reason})` }
      }
      // `unknown` may have written bytes: only the transcript may decide from here.
      return { outcome: 'sent' }
    },
    async answer(paneKey, agent, answer, signal) {
      const guard = createLaunchedAgentWriteGuard(runtime, agent, {
        unprovableHost: 'write-unless-shell'
      })
      try {
        const outcome = await answers.answer(runtime, target(paneKey, agent), {
          ...answer,
          signal,
          beforeWrite: (ptyId) => guard.beforeWrite(ptyId)
        })
        if (outcome.outcome === 'accepted') {
          return { ok: true }
        }
        if (outcome.outcome === 'unknown') {
          return { ok: false, reason: 'failed', error: 'The answer may not have reached the pane' }
        }
        return {
          ok: false,
          reason:
            outcome.reason === 'prompt_not_pending' || outcome.reason === 'option_not_offered'
              ? outcome.reason
              : 'not_answerable'
        }
      } finally {
        guard.dispose()
      }
    }
  }

  return {
    panes,
    input,
    subscribe: (onChange: () => void) => runtime.agentTransitions.subscribe(() => onChange())
  }
}
