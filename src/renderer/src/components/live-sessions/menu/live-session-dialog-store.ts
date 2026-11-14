import { useSyncExternalStore } from 'react'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { LiveSessionDangerKind } from './live-session-menu'

export type LiveSessionDialog =
  | { kind: 'rename'; session: LiveSession }
  | { kind: 'message'; session: LiveSession }
  | { kind: 'danger'; danger: LiveSessionDangerKind; sessions: LiveSession[] }

let current: LiveSessionDialog | null = null
const listeners = new Set<() => void>()

/** The one dialog a session menu has open, wherever the menu was (sidebar, tab, palette). */
export const liveSessionDialogStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getState: (): LiveSessionDialog | null => current,
  show(dialog: LiveSessionDialog | null): void {
    current = dialog
    for (const listener of listeners) {
      listener()
    }
  }
}

export function useLiveSessionDialog(): LiveSessionDialog | null {
  return useSyncExternalStore(liveSessionDialogStore.subscribe, liveSessionDialogStore.getState)
}
