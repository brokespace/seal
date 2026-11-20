import { useAppStore } from '@/store'
import { rememberMachineSelection } from '@/components/machines/model/machine-selection'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import { parseMachineId } from '../../../../shared/machines/machine-types'
import { openAccountsSettings } from '../settings/seal-accounts/seal-accounts-navigation'
import type { HomeOverviewActions } from './home-overview-model'

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
  openMachine: (machine) => {
    const machineId = parseMachineId(machine.id)
    if (machineId) {
      rememberMachineSelection(machineId)
    }
    useAppStore.getState().openMachinesPage()
  },
  openMachines: () => useAppStore.getState().openMachinesPage()
}
