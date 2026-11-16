import type { ActiveAgentsScope } from './active-agents-model'

/** The workspace or project last shown from its badge or its overview. Recorded only: session rows live under their workspaces and no list narrows by it. */
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
