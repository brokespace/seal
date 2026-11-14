import { createContext } from 'react'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import type {
  HomeAccount,
  HomeAutomationsResult,
  HomeMachine,
  HomeOverviewActions,
  HomeWorkspace
} from './home-overview-model'

const noop = (): void => {}

/** The live-session registry's sessions: Home lists the records Active agents lists. */
export const HomeSessionsContext = createContext<readonly LiveSession[]>([])
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
