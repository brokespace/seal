import { createContext, useContext } from 'react'
import type { AgentConfigLayout } from '../../../../../shared/agent-config/agent-config-catalog'
import type {
  AgentConfigScope,
  AgentConfigSnapshot,
  AgentConfigTarget
} from '../../../../../shared/agent-config/agent-config-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'

export type AgentConfigCopyProject = { label: string; path: string; machineId: string }

export type AgentConfigPanelState = {
  machine: MachineSummary
  machines: readonly MachineSummary[]
  /** Projects a document or server can be copied into. */
  projects: readonly AgentConfigCopyProject[]
  target: AgentConfigTarget
  layout: AgentConfigLayout
  snapshot: AgentConfigSnapshot
  /** The scope new things go to here: the account on a machine page, the project on a project page. */
  homeScope: Extract<AgentConfigScope, 'user' | 'project'>
  reload: () => void
  /** Runs a change, reloads, and shows a failure as a toast. Resolves to undefined on failure. */
  apply: <T>(work: () => Promise<T>, done?: string) => Promise<T | undefined>
}

const AgentConfigContext = createContext<AgentConfigPanelState | null>(null)

export const AgentConfigProvider = AgentConfigContext.Provider

export function useAgentConfig(): AgentConfigPanelState {
  const state = useContext(AgentConfigContext)
  if (!state) {
    throw new Error('Agent configuration sections render inside the panel')
  }
  return state
}
