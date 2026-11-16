import { useMemo } from 'react'
import type { AgentJournalRenderItem } from '../../../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentSessionOptionsResult } from '../../../../../shared/agent-session/options/agent-session-options-result'
import {
  selectStructuredAgentSessionContextUsage,
  type StructuredAgentContextUsage
} from '../../../../../shared/agent-session/structured-agent-session-context-usage'

/**
 * Older hosts send no whole-journal answer, which leaves the loaded window's facts unchanged.
 * With no older page left unloaded, the compactions in view are all of them.
 */
export function useStructuredAgentSessionContextUsage(
  journalItems: readonly AgentJournalRenderItem[],
  support: AgentSessionOptionsResult['contextUsage'],
  journal: { epoch: string | null; hasOlder: boolean }
): StructuredAgentContextUsage | null {
  const { epoch, hasOlder } = journal
  return useMemo(
    () => selectStructuredAgentSessionContextUsage(journalItems, support, epoch, !hasOlder),
    [journalItems, support, epoch, hasOlder]
  )
}
