import { parseExecutionHostId } from '../../../../../shared/execution-host'
import type {
  MachineDirListing,
  MachineFileEntry,
  MachineId
} from '../../../../../shared/machines/machine-types'
import { browseRuntimeServerDirectory } from '@/runtime/files/reads/runtime-server-directory-browser'

export type ExplorerListing = Pick<
  MachineDirListing,
  'path' | 'entries' | 'totalEntries' | 'offset'
>

/** Full machines list over the desktop's SSH/local access; runtimes browse through their own RPC. */
export async function listMachineDirectory(
  machineId: MachineId,
  path: string | null,
  options: { force?: boolean; offset?: number } = {}
): Promise<ExplorerListing> {
  const parsed = parseExecutionHostId(machineId)
  if (parsed?.kind === 'runtime') {
    const listing = await browseRuntimeServerDirectory(parsed.environmentId, path ?? '')
    const entries: MachineFileEntry[] = listing.entries.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory ? 'directory' : entry.isSymlink ? 'symlink' : 'file',
      isDirectoryLike: entry.isDirectory,
      size: 0,
      mtimeMs: 0
    }))
    return { path: listing.resolvedPath, entries, totalEntries: entries.length, offset: 0 }
  }
  const api = window.api.machines
  if (!api) {
    throw new Error('Machine browsing is only available in the desktop app')
  }
  return api.listDir({ machineId, path: path ?? undefined, ...options })
}
