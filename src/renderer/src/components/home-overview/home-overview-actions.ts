import { useAppStore } from '@/store'
import { revealDashboardAgent } from '@/components/dashboard/reveal-dashboard-agent'
import { liveSessionRegistryStore } from '@/components/live-sessions/live-session-registry-store'
import { rememberLiveSessionSelection } from '@/components/live-sessions/live-session-selection'
import { rememberMachineSelection } from '@/components/machines/model/machine-selection'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import { parseMachineId } from '../../../../shared/machines/machine-types'
import type { SettingsNavigationTarget } from '../settings/navigation/settings-navigation-types'
import type { HomeOverviewActions, HomeSession } from './home-overview-model'

// Setting a target alone only queues the deep link; the page must be opened too.
function openSettingsPane(target: SettingsNavigationTarget): void {
  const state = useAppStore.getState()
  state.openSettingsTarget(target)
  state.openSettingsPage()
}

/** Settings > Accounts, where Seal's account vault lives. */
function openAccountsSettings(): void {
  openSettingsPane({ pane: 'accounts', repoId: null })
}

function openAutomations(): void {
  useAppStore.getState().openAutomationsPage()
}

const sharedActions = {
  openAccountsSettings,
  openAutomations,
  openWorkspace: (workspace) => {
    const executionHostId = normalizeExecutionHostId(workspace.machineId)
    activateAndRevealWorkspace(workspace.id, executionHostId ? { executionHostId } : undefined)
  },
  openAutomation: (automation) => {
    useAppStore.getState().setSelectedAutomationId(automation.id)
    openAutomations()
  }
} satisfies Partial<HomeOverviewActions>

/** Opens the Agent sessions page on the registry entry for a session, when it has one. */
function openLiveSession(session: HomeSession): void {
  const liveId =
    session.target.kind === 'live-session'
      ? session.target.sessionId
      : liveSessionRegistryStore
          .getState()
          .sessions.find((live) =>
            live.inputRoutes.some(
              (route) => route.kind === 'seal-pane' && route.paneKey === session.id
            )
          )?.id
  if (liveId) {
    rememberLiveSessionSelection(liveId)
  }
  useAppStore.getState().openSessionsPage()
}

/** Actions for Orca builds without the machines page or live-session registry. */
export const orcaHomeOverviewActions: HomeOverviewActions = {
  ...sharedActions,
  openSession: (session) => {
    if (session.target.kind === 'orca-pane') {
      revealDashboardAgent(session.target.reveal)
    }
  },
  openMachine: () => openSettingsPane({ pane: 'servers', repoId: null }),
  openMachines: () => openSettingsPane({ pane: 'servers', repoId: null })
}

export const sealHomeOverviewActions: HomeOverviewActions = {
  ...sharedActions,
  openSession: (session) => {
    // A pane on a host that isn't loaded can't be revealed; its transcript is on Agent sessions.
    if (session.target.kind === 'orca-pane' && revealDashboardAgent(session.target.reveal)) {
      return
    }
    openLiveSession(session)
  },
  openMachine: (machine) => {
    const machineId = parseMachineId(machine.id)
    if (machineId) {
      rememberMachineSelection(machineId)
    }
    useAppStore.getState().openMachinesPage()
  },
  openMachines: () => useAppStore.getState().openMachinesPage()
}
