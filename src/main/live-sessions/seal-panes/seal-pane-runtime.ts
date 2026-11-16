import type { AgentStatusIpcPayload } from '../../../shared/agent-status/contracts/agent-status-ipc-payload'
import type { PendingPrompt } from '../../../shared/agent-status/contracts/agent-pending-prompt'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { TerminalAgentPromptAnswers } from '../../runtime/terminal/input/terminal-agent-prompt-answer'
import { createLaunchedAgentWriteGuard } from '../../runtime/terminal/wait/launched-agent-write-guard'
import { bindPane, deliverFollowUp } from '../../external-conversations/external-conversation-send'
import { liveSessionAdapter } from '../adapters/live-session-adapters'
import type { SealPaneInput } from '../delivery/session-input-routes'
import { sealPanesFromRows, type SealPane } from './seal-pane-sessions'

export type SealPaneHookRows = {
  snapshot(): AgentStatusIpcPayload[]
  /** Probes the pane's agent process; a pane whose agent has exited gives up its status row. */
  checkAgentPresence(paneKey: string): Promise<unknown>
}

/** One agent-process check per pane in this long. */
const AGENT_CHECK_MS = 15_000

/** Seal panes reuse Orca's own pane writer: it waits through approvals and fences replaced processes. */
export function createSealPaneAccess(runtime: OrcaRuntimeService, rows: SealPaneHookRows) {
  const readHookRow = (paneKey: string) => runtime.agentTransitions.latestRow(paneKey)
  const answers = new TerminalAgentPromptAnswers(readHookRow)
  const target = (paneKey: string, agent: LiveSession['provider']) => ({
    paneKey,
    agent,
    answerable: true
  })

  const pendingPrompt = (paneKey: string, agent: LiveSession['provider']): PendingPrompt | null => {
    try {
      return answers.pending(runtime, target(paneKey, agent))
    } catch {
      return null
    }
  }

  const agentChecks = new Map<string, number>()

  const panes = (): SealPane[] => {
    const latest = new Map<string, AgentStatusIpcPayload>()
    for (const row of rows.snapshot()) {
      const had = latest.get(row.paneKey)
      if (!row.providerSessionOnly && (!had || row.receivedAt > had.receivedAt)) {
        latest.set(row.paneKey, row)
      }
    }
    return sealPanesFromRows([...latest.values()], pendingPrompt, Date.now())
  }

  const input: SealPaneInput = {
    async send(paneKey, agent, text, requestId, signal) {
      if (!liveSessionAdapter(agent)?.cli) {
        return { outcome: 'unavailable', reason: `Seal cannot type into a ${agent} pane` }
      }
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
      if ((liveSessionAdapter(agent)?.cli?.answers ?? 'none') === 'none') {
        return { ok: false, reason: 'not_answerable' }
      }
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
    confirmAgent: (paneKey: string) => {
      const now = Date.now()
      if (now - (agentChecks.get(paneKey) ?? -Infinity) < AGENT_CHECK_MS) {
        return
      }
      for (const [key, at] of agentChecks) {
        if (now - at >= AGENT_CHECK_MS) {
          agentChecks.delete(key)
        }
      }
      agentChecks.set(paneKey, now)
      void rows.checkAgentPresence(paneKey).catch(() => null)
    },
    subscribe: (onChange: () => void) => runtime.agentTransitions.subscribe(() => onChange())
  }
}
