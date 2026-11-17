import { createContext } from 'react'

/**
 * Seal: called when the reader leaves the newest row. The chat's source keeps the rows on view
 * until the returned call says the reader is back.
 */
export const MobileNativeChatHistoryRetentionContext = createContext<
  (() => () => void) | undefined
>(undefined)
