import { useMemo } from 'react'
import { useLiveSessionPaletteSource } from '@/components/live-sessions/palette/live-session-palette-source'
import type { PaletteExtraSource } from './palette-extra-results'

const NO_SOURCES: readonly PaletteExtraSource[] = []

/** Each source registers here with its own hook; return a memoized list. */
export function usePaletteExtraSources(args: {
  query: string
  visible: boolean
}): readonly PaletteExtraSource[] {
  const liveSessions = useLiveSessionPaletteSource(args)
  return useMemo(() => (liveSessions ? [liveSessions] : NO_SOURCES), [liveSessions])
}
