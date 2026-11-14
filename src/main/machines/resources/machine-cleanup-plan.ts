import type { MachineCleanupItem } from '../../../shared/machines/machine-resource-types'

/** How one listed item is removed; the user confirms the item, main holds the command. */
export type MachineCleanupAction =
  /** `rm -rf` of exactly this path. */
  | { kind: 'remove'; path: string }
  /** Deletes what is inside these folders and keeps the folders. */
  | { kind: 'empty'; paths: string[] }
  /** `docker <args…>`; every argument is passed as one quoted word. */
  | { kind: 'docker'; args: string[] }

export type PlannedCleanupItem = MachineCleanupItem & { action: MachineCleanupAction }

export type MachineCleanupPlan = {
  items: PlannedCleanupItem[]
  omittedCount: number
  unavailable: string | null
}

/** Paths a cleanup may never remove, whatever a scan printed. */
export function isRemovableCleanupPath(path: string, homeDir: string | null): boolean {
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\n')) {
    return false
  }
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 2 || segments.includes('..') || segments.includes('.')) {
    return false
  }
  const normalized = `/${segments.join('/')}`
  return normalized !== homeDir?.replace(/\/+$/, '')
}
