import type { NativeChatContextUsageSummary } from '../../../../../shared/native-chat/native-chat-context-usage-summary'

/** The ring's input: the summary every source fills, plus what only the view holding it knows. */
export type NativeChatContextUsageRingInput = NativeChatContextUsageSummary & {
  /** A compaction is running. */
  compacting?: boolean
  /** Compacts the session now; absent where the session cannot be asked to. */
  onCompact?: () => void
  /** The session cannot compact right now, such as while a turn runs. */
  compactDisabled?: boolean
}
