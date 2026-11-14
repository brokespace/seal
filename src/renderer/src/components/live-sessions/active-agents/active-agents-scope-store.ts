import { useSyncExternalStore } from 'react'
import type { ActiveAgentsScope } from './active-agents-model'

/** The workspace or project Active agents is narrowed to, set from its badge in Projects. */
export class ActiveAgentsScopeStore {
  private scope: ActiveAgentsScope | null = null
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): ActiveAgentsScope | null => this.scope

  setScope(scope: ActiveAgentsScope | null): void {
    this.scope = scope
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const activeAgentsScopeStore = new ActiveAgentsScopeStore()

export function useActiveAgentsScope(): ActiveAgentsScope | null {
  return useSyncExternalStore(activeAgentsScopeStore.subscribe, activeAgentsScopeStore.getState)
}
