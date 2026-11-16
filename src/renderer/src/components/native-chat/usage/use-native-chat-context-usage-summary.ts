import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useLatestHandler } from '@/lib/use-latest-handler'
import type { NativeChatStructuredComposerTransport } from '../composer/submit/native-chat-structured-composer-transport'
import { liveSessionRegistryStore } from '@/components/live-sessions/live-session-registry-store'
import {
  summarizeContextUsage,
  type NativeChatContextUsageSummary
} from '../../../../../shared/native-chat/native-chat-context-usage-summary'
import {
  isContextUsageMeasured,
  unmeasuredContextUsage
} from '../../../../../shared/native-chat/native-chat-context-usage-state'
import { resolveNativeChatTranscriptAgent } from '../../../../../shared/native-chat/native-chat-agent-support'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import { contextUsageOfMessages } from '../../../../../shared/live-sessions/adapters/agent-session-context-samples'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { NativeChatContextUsageRingInput } from './native-chat-context-usage-ring-input'

/** A session with no structured journal: its transcript and its registry record are the sources. */
export type NativeChatTranscriptContextSource = {
  agent: string | null | undefined
  /** The Seal pane a CLI session runs in, which finds its registry record. */
  paneKey?: string | null
  /** The transcript as the view decoded it. */
  messages?: readonly NativeChatMessage[]
  /** The registry's latest value, where the caller already holds the record. */
  recorded?: NativeChatContextUsageSummary | null
}

/** A compaction the ring asked for gives up its spinner after this, whatever the host says. */
const COMPACTION_WAIT_MS = 120_000

function recordedContextOfPane(
  sessions: readonly LiveSession[],
  paneKey: string
): NativeChatContextUsageSummary | null {
  for (const session of sessions) {
    if (
      session.context &&
      ((session.surface?.kind === 'cli' && session.surface.paneKey === paneKey) ||
        session.inputRoutes.some(
          (route) => route.kind === 'seal-pane' && route.paneKey === paneKey
        ))
    ) {
      return session.context
    }
  }
  return null
}

function useRecordedContextOfPane(
  paneKey: string | null | undefined
): NativeChatContextUsageSummary | null {
  return useSyncExternalStore(liveSessionRegistryStore.subscribe, () =>
    paneKey ? recordedContextOfPane(liveSessionRegistryStore.getState().sessions, paneKey) : null
  )
}

/** The fresher measured reading wins; the record adds the compactions a loaded page cannot count. */
function mergeTranscriptContextUsage(
  decoded: NativeChatContextUsageSummary | null,
  recorded: NativeChatContextUsageSummary | null
): NativeChatContextUsageSummary | null {
  if (!decoded || !recorded) {
    return decoded ?? recorded
  }
  const compaction = {
    ...(recorded.compactions === undefined ? {} : { compactions: recorded.compactions }),
    ...(recorded.lastCompactedAt === undefined ? {} : { lastCompactedAt: recorded.lastCompactedAt })
  }
  const measured = [decoded, recorded]
    .filter(isContextUsageMeasured)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0]
  return measured ? { ...measured, ...compaction } : unmeasuredContextUsage(compaction)
}

/**
 * Context usage of a CLI or external session, from the transcript the view holds and the registry
 * record. Null for agents whose transcripts carry no usage, so no ring shows.
 */
export function useTranscriptContextUsage(
  source: NativeChatTranscriptContextSource | undefined
): NativeChatContextUsageSummary | null {
  const decoder = resolveNativeChatTranscriptAgent(source?.agent)
  const messages = source?.messages
  const decoded = useMemo(
    () => (messages ? contextUsageOfMessages(decoder, messages) : null),
    [decoder, messages]
  )
  const paneRecord = useRecordedContextOfPane(source?.paneKey)
  const recorded = source?.recorded ?? paneRecord
  return useMemo(() => mergeTranscriptContextUsage(decoded, recorded), [decoded, recorded])
}

type CompactControl = Pick<NativeChatContextUsageRingInput, 'compacting' | 'onCompact'>

/** "Compact now" for a structured chat whose host takes the command; the spinner ends at the compaction's notice. */
function useContextCompactControl(
  transport: NativeChatStructuredComposerTransport | undefined,
  lastCompactedAt: number | undefined
): CompactControl {
  const supported = transport?.conversationCommands?.includes('compact') === true
  // The notice time the request started from; a newer one means it finished.
  const [requestedFrom, setRequestedFrom] = useState<{ lastCompactedAt?: number } | null>(null)
  const compacting = requestedFrom !== null && requestedFrom.lastCompactedAt === lastCompactedAt
  useEffect(() => {
    if (!compacting) {
      return
    }
    const timer = setTimeout(() => setRequestedFrom(null), COMPACTION_WAIT_MS)
    return () => clearTimeout(timer)
  }, [compacting])
  // Stable across journal updates, which rebuild the transport, so the composer's controls don't redraw.
  const onCompact = useLatestHandler(() => {
    if (!transport) {
      return
    }
    setRequestedFrom(lastCompactedAt === undefined ? {} : { lastCompactedAt })
    void transport
      .dispatchCommand('/compact')
      .then((outcome) => {
        if (!outcome.accepted) {
          setRequestedFrom(null)
          transport.onError(outcome.error)
        }
      })
      .catch(() => setRequestedFrom(null))
  })
  return useMemo(
    () => (supported ? { compacting, onCompact } : {}),
    [supported, compacting, onCompact]
  )
}

/**
 * The composer ring's input for every chat view: a structured chat's journal, or a terminal-backed
 * chat's transcript (the messages its prompt recall already holds). Null where the agent supplies
 * no usage.
 */
export function useContextRingInput(
  structuredTransport: NativeChatStructuredComposerTransport | undefined,
  transcript: { messages: readonly NativeChatMessage[] } | undefined,
  agent: string | null | undefined,
  paneKey: string | null | undefined
): NativeChatContextUsageRingInput | null {
  const usage = structuredTransport?.contextUsage ?? null
  const structured = useMemo(() => (usage ? summarizeContextUsage(usage) : null), [usage])
  const decoded = useTranscriptContextUsage(
    structuredTransport ? undefined : { agent, paneKey, messages: transcript?.messages }
  )
  const summary = structuredTransport ? structured : decoded
  const control = useContextCompactControl(structuredTransport, summary?.lastCompactedAt)
  return useMemo(() => (summary ? { ...summary, ...control } : null), [summary, control])
}
