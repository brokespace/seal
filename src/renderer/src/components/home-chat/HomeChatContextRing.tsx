import { useCallback, useMemo, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { NativeChatContextUsageRing } from '../native-chat/usage/NativeChatContextUsageRing'
import type { NativeChatContextUsageRingInput } from '../native-chat/usage/native-chat-context-usage-ring-input'
import type { HomeChatSummary } from '../../../../shared/home-chat/home-chat-types'

/** Runs the thread's compaction; settles when it has finished, or at once when there is no thread. */
type HomeChatCompact = () => Promise<unknown> | undefined

type WatchedCompaction = { chatId: string; count: number; lastCompactedAt?: number }

/** The thread summary carries a compaction count and no time, so the ring times what it sees happen. */
function useLastWatchedCompaction(chat: HomeChatSummary): number | undefined {
  const { id: chatId, updatedAt } = chat
  const count = chat.context.compactions
  const [watch, setWatch] = useState<WatchedCompaction>({ chatId, count })
  if (watch.chatId !== chatId) {
    setWatch({ chatId, count })
  } else if (watch.count !== count) {
    setWatch({
      chatId,
      count,
      lastCompactedAt: count > watch.count ? updatedAt : watch.lastCompactedAt
    })
  }
  return watch.lastCompactedAt
}

/** The compaction the ring started and has not seen finish; held here across a thread switch. */
function useRingStartedCompaction(
  chatId: string | null,
  onCompact: HomeChatCompact
): { compacting: boolean; compact: () => void } {
  const [compactingChatId, setCompactingChatId] = useState<string | null>(null)
  const compact = useCallback(() => {
    const finished = onCompact()
    if (!finished || chatId === null) {
      return
    }
    setCompactingChatId(chatId)
    void finished.finally(() =>
      setCompactingChatId((current) => (current === chatId ? null : current))
    )
  }, [onCompact, chatId])
  return { compacting: chatId !== null && compactingChatId === chatId, compact }
}

function ThreadContextRing({
  chat,
  compacting,
  onCompact: compact
}: {
  chat: HomeChatSummary
  compacting: boolean
  onCompact: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { usedTokens, windowTokens, compactions } = chat.context
  const percentage = windowTokens > 0 ? Math.round((usedTokens / windowTokens) * 100) : 0
  const compactDisabled = chat.status === 'running'
  const lastCompactedAt = useLastWatchedCompaction(chat)
  const usage = useMemo<NativeChatContextUsageRingInput>(
    () => ({
      usedTokens,
      windowTokens,
      percentage,
      // The thread summary does not say whether a provider measured its size; most drivers estimate it.
      estimated: true,
      rows: [],
      compactions,
      ...(lastCompactedAt === undefined ? {} : { lastCompactedAt }),
      compacting,
      onCompact: compact,
      compactDisabled
    }),
    [
      usedTokens,
      windowTokens,
      percentage,
      compactions,
      lastCompactedAt,
      compacting,
      compact,
      compactDisabled
    ]
  )

  return (
    <div
      // A composer too narrow for the words keeps the ring; the card's title still names the state.
      className="flex @max-[34rem]/home-chat-composer:[&_[data-native-chat-context-text]]:hidden"
      data-home-chat-context={percentage}
    >
      <NativeChatContextUsageRing
        usage={usage}
        note={
          // The description states a share of the window, so it waits for a measured one.
          windowTokens > 0 ? (
            <p className="text-2xs text-muted-foreground" data-home-chat-compactions={compactions}>
              {t(
                'homeChat.context.description',
                'What the model reads on its next turn: {{percent}}% of its window. When it fills, Seal summarizes older messages for the model; the thread you see stays complete.',
                { percent: percentage }
              )}
            </p>
          ) : undefined
        }
      />
    </div>
  )
}

/** How full the thread's context is, beside Send; stays mounted when the thread changes. */
export function HomeChatContextRing({
  chat,
  onCompact
}: {
  chat: HomeChatSummary | null
  onCompact: HomeChatCompact
}): React.JSX.Element | null {
  const { compacting, compact } = useRingStartedCompaction(chat?.id ?? null, onCompact)
  return chat ? <ThreadContextRing chat={chat} compacting={compacting} onCompact={compact} /> : null
}
