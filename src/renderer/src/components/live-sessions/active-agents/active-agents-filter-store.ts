import { useSyncExternalStore } from 'react'
import type { ActiveAgentsChip, ActiveAgentsFilter, ActiveAgentsScope } from './active-agents-model'

const NO_FILTER: ActiveAgentsFilter = { query: '', chips: new Set(), scope: null }

/** What Active agents is narrowed to: the search words, the quick chips, a Projects scope. */
export class ActiveAgentsFilterStore {
  private state: ActiveAgentsFilter = NO_FILTER
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): ActiveAgentsFilter => this.state

  setQuery(query: string): void {
    this.set({ query })
  }

  toggleChip(chip: ActiveAgentsChip): void {
    const chips = new Set(this.state.chips)
    if (!chips.delete(chip)) {
      chips.add(chip)
    }
    this.set({ chips })
  }

  setScope(scope: ActiveAgentsScope | null): void {
    this.set({ scope })
  }

  clear(): void {
    this.set(NO_FILTER)
  }

  private set(patch: Partial<ActiveAgentsFilter>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const activeAgentsFilterStore = new ActiveAgentsFilterStore()

export function useActiveAgentsFilter(): ActiveAgentsFilter {
  return useSyncExternalStore(activeAgentsFilterStore.subscribe, activeAgentsFilterStore.getState)
}
