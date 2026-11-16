import { useMemo } from 'react'
import type { AgentJournalRenderItem } from '../../../../../src/shared/agent-session/journal/agent-session-journal-types'
import type { AgentSessionOptionsResult } from '../../../../../src/shared/agent-session/options/agent-session-options-result'
import { selectStructuredAgentSessionContextUsage } from '../../../../../src/shared/agent-session/structured-agent-session-context-usage'
import {
  summarizeContextUsage,
  type NativeChatContextUsageSummary
} from '../../../../../src/shared/native-chat/native-chat-context-usage-summary'

/**
 * The composer ring's readout, from desktop's rule; an older host's missing answer leaves the loaded
 * window's facts. With no older page left unloaded, the compactions in view are all of them.
 */
export function useMobileStructuredContextUsage(
  journalItems: readonly AgentJournalRenderItem[],
  support: AgentSessionOptionsResult['contextUsage'],
  journal: { epoch: string | null; hasOlder: boolean }
): NativeChatContextUsageSummary | null {
  const { epoch, hasOlder } = journal
  return useMemo(() => {
    const usage = selectStructuredAgentSessionContextUsage(journalItems, support, epoch, !hasOlder)
    return usage ? summarizeContextUsage(usage) : null
  }, [journalItems, support, epoch, hasOlder])
}
