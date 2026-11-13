import type { ComponentType, ReactNode } from 'react'
import type { HomeSession } from '../../../../shared/home-overview/home-overview-types'

export type {
  HomeAccount,
  HomeAccountStatus,
  HomeAutomation,
  HomeAutomationsResult,
  HomeMachine,
  HomeMachineKind,
  HomeMachineStatus,
  HomeReviewState,
  HomeSession,
  HomeSessionState,
  HomeSessionTarget,
  HomeUsageWindow,
  HomeUsageWindowKind,
  HomeWorkspace
} from '../../../../shared/home-overview/home-overview-types'

export type HomeOverviewActions = {
  openSession: (session: HomeSession) => void
  openAutomations: () => void
  openMachines: () => void
  openAccountsSettings: () => void
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
