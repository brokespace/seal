import type { MachineId } from '../../../../../shared/machines/machine-types'

// Reopening the page returns to the machine last picked there or opened from another surface (Home).
let lastSelectedMachineId: MachineId | null = null

export function getLastSelectedMachineId(): MachineId | null {
  return lastSelectedMachineId
}

export function rememberMachineSelection(machineId: MachineId): void {
  lastSelectedMachineId = machineId
}
