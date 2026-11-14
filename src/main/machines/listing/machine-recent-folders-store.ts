import { join } from 'node:path'
import { z } from 'zod'
import { readNodeFileSyncWithinLimit } from '../../../shared/file-content/node-bounded-file-reader'
import type { MachineId } from '../../../shared/machines/machine-types'
import { writeSecureJsonFileWithinLimit } from '../../../shared/secure-storage/bounded-secure-json-file'

const RECENT_FOLDERS_FILE = 'seal-machine-recent-folders.json'
const MAX_STORE_BYTES = 512 * 1024
export const MAX_RECENT_FOLDERS = 12

const RecentFoldersSchema = z.object({
  version: z.literal(1),
  /** Newest first, keyed by machine id so the list survives switching transport. */
  folders: z.record(z.string(), z.array(z.string()))
})
type RecentFolders = z.infer<typeof RecentFoldersSchema>

/** "Go to folder" history per machine, kept across restarts. */
export class MachineRecentFoldersStore {
  private cached: RecentFolders | null = null

  constructor(private readonly userDataPath: string) {}

  private read(): RecentFolders {
    if (this.cached) {
      return this.cached
    }
    let store: RecentFolders = { version: 1, folders: {} }
    try {
      const file = readNodeFileSyncWithinLimit(
        join(this.userDataPath, RECENT_FOLDERS_FILE),
        MAX_STORE_BYTES,
        { regularFileOnly: true }
      )
      const parsed = RecentFoldersSchema.safeParse(JSON.parse(file.buffer.toString('utf8')))
      if (parsed.success) {
        store = parsed.data
      }
    } catch {
      // A missing or unreadable history starts empty.
    }
    this.cached = store
    return store
  }

  list(machineId: MachineId): string[] {
    return this.read().folders[machineId] ?? []
  }

  remember(machineId: MachineId, path: string): string[] {
    const store = this.read()
    const next = [path, ...this.list(machineId).filter((known) => known !== path)].slice(
      0,
      MAX_RECENT_FOLDERS
    )
    this.cached = { version: 1, folders: { ...store.folders, [machineId]: next } }
    writeSecureJsonFileWithinLimit(
      join(this.userDataPath, RECENT_FOLDERS_FILE),
      this.cached,
      MAX_STORE_BYTES
    )
    return next
  }
}
