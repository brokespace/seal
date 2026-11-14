import type { ComponentType, ReactNode } from 'react'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'

export type HomeMachineKind = 'local' | 'ssh' | 'runtime'
export type HomeMachineStatus = 'online' | 'connecting' | 'offline' | 'error'

export type HomeMachine = {
  id: string
  label: string
  kind: HomeMachineKind
  status: HomeMachineStatus
  /** 1-minute load average divided by core count (1 = fully busy); absent when unknown. */
  load?: number
  memoryUsedPercent?: number
  error?: string
}

export type HomeUsageWindowKind = 'session' | 'weekly' | 'monthly'

export type HomeUsageWindow = {
  kind: HomeUsageWindowKind
  usedPercent: number
  resetsAt: number | null
}

export type HomeAccountStatus = 'ok' | 'loading' | 'error' | 'unavailable'

export type HomeAccount = {
  id: string
  provider: string
  providerLabel: string
  /** Email or account name; falls back to the provider label. */
  label: string
  /** The account new sessions use for this provider. */
  active: boolean
  status: HomeAccountStatus
  windows: HomeUsageWindow[]
  error?: string
}

export type HomeReviewState = 'open' | 'draft' | 'merged' | 'closed'

export type HomeWorkspace = {
  id: string
  projectName: string
  name: string
  machineId: string
  isFolder: boolean
  review?: { number: number; state: HomeReviewState }
}

export type HomeAutomation = {
  id: string
  name: string
  enabled: boolean
  nextRunAt: number | null
  lastRunAt: number | null
}

export type HomeAutomationsResult = {
  automations: HomeAutomation[]
  status: 'loading' | 'ready' | 'error'
}

/** Every Home click goes through one of these; each must navigate somewhere real. */
export type HomeOverviewActions = {
  openSession: (session: LiveSession) => void
  openMachine: (machine: HomeMachine) => void
  openMachines: () => void
  openAccountsSettings: () => void
  openWorkspace: (workspace: HomeWorkspace) => void
  openAutomation: (automation: HomeAutomation) => void
  openAutomations: () => void
}

export type HomeProviderComponent = ComponentType<{ children: ReactNode }>

/**
 * Data sources behind Home. Each provider renders its matching context from
 * `home-overview-contexts` around `children`; swap one to change where that data comes from.
 */
export type HomeOverviewProviders = {
  /** Optional wrapper for state shared between this bundle's providers. */
  Root?: HomeProviderComponent
  Sessions: HomeProviderComponent
  Machines: HomeProviderComponent
  Accounts: HomeProviderComponent
  Workspaces: HomeProviderComponent
  Automations: HomeProviderComponent
  Actions: HomeProviderComponent
}
