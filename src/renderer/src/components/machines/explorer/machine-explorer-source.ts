import type { MachineDirListing, MachineId } from '../../../../../shared/machines/machine-types'

export type ExplorerListing = Pick<
  MachineDirListing,
  'path' | 'entries' | 'totalEntries' | 'offset'
>

export async function listMachineDirectory(
  machineId: MachineId,
  path: string | null,
  options: { force?: boolean; offset?: number } = {}
): Promise<ExplorerListing> {
  const api = window.api.machines
  if (!api) {
    throw new Error('Machine browsing is only available in the desktop app')
  }
  return api.listDir({ machineId, path: path ?? undefined, ...options })
}

/** Lets a caller put its own safeguards around edits (agent settings back files up first). */
export type MachineExplorerFileOps = {
  /** The text to show for a file, when it is not simply the file's bytes (hidden secrets). */
  readText?: (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  remove: (paths: string[]) => Promise<void>
  /** Shown in the delete confirmation in place of "cannot be undone". */
  removeDescription?: string
}
