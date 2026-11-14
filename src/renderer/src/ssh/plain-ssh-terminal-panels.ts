// Keep one plain SSH window per host outside store/session; never persist, restore or sync it.
import { useSyncExternalStore } from 'react'
import type { MachineId } from '../../../shared/machines/machine-types'

/** A shell (or agent) over the machine's own connection, SSH or Seal server alike. */
export type MachineTerminalLaunch = {
  machineId: MachineId
  cwd?: string
  command?: string
  agent?: string
  prompt?: string
}

export type PlainSshPanel = {
  targetId: string
  label: string
  minimized: boolean
  /** `machine-shell`: opened from Machines for any host, not only move-blocked ones. */
  purpose?: 'machine-shell'
  /** Set for machine terminals; `targetId` is then just this panel's key. */
  machine?: MachineTerminalLaunch
}

let panels: readonly PlainSshPanel[] = []
const listeners = new Set<() => void>()

function publish(next: readonly PlainSshPanel[]): void {
  panels = next
  for (const listener of listeners) {
    listener()
  }
}

/** Shows the host's window, opening it if needed; only one is expanded at a time. */
export function showPlainSshPanel(
  targetId: string,
  label: string,
  purpose?: PlainSshPanel['purpose']
): void {
  const rest = panels
    .filter((panel) => panel.targetId !== targetId)
    .map((panel) => (panel.minimized ? panel : { ...panel, minimized: true }))
  const current = panels.find((panel) => panel.targetId === targetId)
  publish([
    ...rest,
    {
      targetId,
      label: current?.label ?? label,
      minimized: false,
      purpose: current?.purpose ?? purpose,
      ...(current?.machine ? { machine: current.machine } : {})
    }
  ])
}

let machinePanelCount = 0

export function showMachineTerminalPanel(label: string, machine: MachineTerminalLaunch): void {
  machinePanelCount += 1
  const key = `${machine.machineId}#${machinePanelCount}`
  publish([
    ...panels.map((panel) => (panel.minimized ? panel : { ...panel, minimized: true })),
    { targetId: key, label, minimized: false, machine }
  ])
}

export function minimizePlainSshPanel(targetId: string): void {
  publish(
    panels.map((panel) => (panel.targetId === targetId ? { ...panel, minimized: true } : panel))
  )
}

export function removePlainSshPanel(targetId: string): void {
  publish(panels.filter((panel) => panel.targetId !== targetId))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePlainSshPanels(): readonly PlainSshPanel[] {
  return useSyncExternalStore(subscribe, () => panels)
}
