import { createContext } from 'react'
import type {
  HomeAccount,
  HomeAutomationsResult,
  HomeMachine,
  HomeOverviewActions,
  HomeSession,
  HomeWorkspace
} from './home-overview-model'

const noop = (): void => {}

export const HomeSessionsContext = createContext<readonly HomeSession[]>([])
export const HomeMachinesContext = createContext<readonly HomeMachine[]>([])
export const HomeAccountsContext = createContext<readonly HomeAccount[]>([])
export const HomeWorkspacesContext = createContext<readonly HomeWorkspace[]>([])
export const HomeAutomationsContext = createContext<HomeAutomationsResult>({
  automations: [],
  status: 'loading'
})
export const HomeActionsContext = createContext<HomeOverviewActions>({
  openSession: noop,
  openMachine: noop,
  openMachines: noop,
  openAccountsSettings: noop,
  openWorkspace: noop,
  openAutomation: noop,
  openAutomations: noop
})
