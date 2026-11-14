import { useAppStore } from '@/store'
import { openLiveSessionView } from '@/components/live-sessions/menu/live-session-menu-effects'
import { rememberMachineSelection } from '@/components/machines/model/machine-selection'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import { parseMachineId } from '../../../../shared/machines/machine-types'
import type { SettingsNavigationTarget } from '../settings/navigation/settings-navigation-types'
import type { HomeOverviewActions } from './home-overview-model'

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

export const sealHomeOverviewActions: HomeOverviewActions = {
  ...sharedActions,
  openSession: (session) => openLiveSessionView(session.id),
  openMachine: (machine) => {
    const machineId = parseMachineId(machine.id)
    if (machineId) {
      rememberMachineSelection(machineId)
    }
    useAppStore.getState().openMachinesPage()
  },
  openMachines: () => useAppStore.getState().openMachinesPage()
}
