import type {
  MachineDirListing,
  MachineFileRead,
  MachineId
} from '../../../../../shared/machines/machine-types'

export type ExplorerListing = Pick<MachineDirListing, 'path' | 'entries' | 'totalEntries'>

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

/** Where a tree's folders come from: the machine's own files, or a place reached another way. */
export type MachineExplorerSource = {
  /** Names the tree, so it is remembered apart from every other tree. */
  key: string
  /** The folder the tree opens on; without one it asks the source for its home folder. */
  startAt?: string
  list: (
    path: string | null,
    options?: { force?: boolean; offset?: number }
  ) => Promise<ExplorerListing>
  /** Tells the tree when a folder it lists changed; left out where nothing reports changes. */
  onChanged?: (listener: (path: string) => void) => () => void
  /** Asks for change reports on exactly these folders. */
  watch?: (dirs: string[]) => void
}

export function machineFilesSource(machineId: MachineId, startAt?: string): MachineExplorerSource {
  return {
    key: startAt ? `${machineId}\n${startAt}` : machineId,
    startAt,
    list: (path, options) => listMachineDirectory(machineId, path, options),
    onChanged: (listener) =>
      window.api.machines?.onDirChanged((event) => {
        if (event.machineId === machineId) {
          listener(event.path)
        }
      }) ?? (() => {}),
    watch: (dirs) => void window.api.machines?.watchDirs({ machineId, dirs }).catch(() => {})
  }
}

/** What a preview shows when the file is not one of the machine's own. */
export type MachineFilePreviewSource = {
  /** Keeps this file's editor state apart from a machine file at the same path. */
  key: string
  read: (path: string) => Promise<MachineFileRead>
  /** The most `read` returns; a longer file comes back truncated. */
  maxBytes: number
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
