import { useSyncExternalStore } from 'react'

const NONE: ReadonlySet<string> = new Set()
let listed = NONE
const listeners = new Set<() => void>()

/**
 * The project headers the sidebar list has now, folded or not. The list says which; the sessions
 * no workspace holds read it to sit under their project's header, or after the list without one.
 */
export const listedProjectHeadersStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getState: (): ReadonlySet<string> => listed,
  set(headerKeys: ReadonlySet<string>): void {
    if (
      headerKeys.size === listed.size &&
      [...headerKeys].every((headerKey) => listed.has(headerKey))
    ) {
      return
    }
    listed = headerKeys.size === 0 ? NONE : headerKeys
    for (const listener of listeners) {
      listener()
    }
  }
}

export function useListedProjectHeaders(): ReadonlySet<string> {
  return useSyncExternalStore(
    listedProjectHeadersStore.subscribe,
    listedProjectHeadersStore.getState
  )
}
