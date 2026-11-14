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
