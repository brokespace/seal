import { useSyncExternalStore } from 'react'

/** The project header a right-click asked to open its actions menu for; one at a time. */
let requested: string | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A right-click on a project header opens the same menu as its "…" button. */
export function repoHeaderContextMenuHandler(
  headerKey: string
): (event: { preventDefault: () => void }) => void {
  return (event) => {
    event.preventDefault()
    requested = headerKey
    notify()
  }
}

export function closeRepoHeaderContextMenu(headerKey: string): void {
  if (requested === headerKey) {
    requested = null
    notify()
  }
}

export function useRepoHeaderContextMenuRequested(headerKey: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => headerKey !== undefined && requested === headerKey,
    () => false
  )
}
