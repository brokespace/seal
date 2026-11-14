/**
 * A running daemon steps aside for a caller with a higher number. Bump it for every change a
 * machine's daemon has to pick up; a build that only differs in name is answered as it is.
 */
export const DISK_INDEX_PROTOCOL = 2

/** Why a disk is not walked by the background index. */
export type MachineDiskIndexSkipReason = 'virtual' | 'network' | 'removable' | 'excluded'

export type MachineDiskIndexMount = {
  mount: string
  /** Device or source, e.g. `/dev/nvme0n1p2`. */
  filesystem: string
  /** e.g. `ext4`; null where the host does not report it. */
  fsType: string | null
  totalBytes: number
  usedBytes: number
  availableBytes: number
  indexed: boolean
  skipReason: MachineDiskIndexSkipReason | null
  /** When the stored index was finished; null until the first scan completes. */
  scannedAt: number | null
  scanDurationMs: number | null
  scanMode: 'full' | 'incremental' | null
  /** Space the index accounts for under this mount. */
  indexedBytes: number | null
  indexedFiles: number | null
  indexedFolders: number | null
  /** Folders the scan could not open, so totals are a lower bound. */
  unreadableFolders: number
}

export type MachineDiskIndexProgress = {
  mount: string
  mode: 'full' | 'incremental'
  startedAt: number
  folders: number
  files: number
  bytes: number
  /** Folders carried over from the previous index without being read again. */
  reusedFolders: number
  /** Folder count of the previous index; null on a first scan. */
  expectedFolders: number | null
}

/** Which step of getting a machine's index running did not work. */
export type MachineDiskIndexUnavailableReason =
  /** The machine has no Node.js new enough to run the index. */
  | 'no-node'
  /** This copy of Seal cannot read its own index program. */
  | 'no-program'
  /** The program could not be copied to the machine. */
  | 'install-failed'
  /** The program is there, but its daemon did not come up. */
  | 'daemon-failed'
  /** The command that asks the daemon failed before it reached it. */
  | 'command-failed'

export type MachineDiskIndexStatus = {
  /** `live` means the machine has no index and sizes are measured on demand. */
  source: 'index' | 'live'
  /** Why there is no index; null when there is one. */
  unavailableReason: MachineDiskIndexUnavailableReason | null
  /** What the machine or Seal said when that step failed, shown as it is. */
  unavailableDetail?: string | null
  mounts: MachineDiskIndexMount[]
  scan: MachineDiskIndexProgress | null
  nextScanAt: number | null
  /** The machine's clock, for turning its timestamps into ages. */
  now: number
  /** Changes whenever a scan finishes. */
  generation: number
  /** macOS folders left out until the person allows them (they raise permission prompts). */
  protectedFoldersSkipped: boolean
}

export type MachineDiskIndexEntry = {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink'
  /** Null for a folder the index has not measured yet. */
  bytes: number | null
  /** Files under a folder; null for files and unmeasured folders. */
  files: number | null
  mtimeMs: number | null
  /** Another disk is mounted here, or the folder is left out of the index. */
  notIndexed: boolean
  unreadable: boolean
}

export type MachineDiskIndexListing = {
  path: string
  /** Null when the folder is not in the index. */
  totalBytes: number | null
  /** Largest first; folders with more children list only the biggest. */
  entries: MachineDiskIndexEntry[]
  omittedCount: number
  omittedBytes: number
  /** Something under this folder could not be read, so totals are a lower bound. */
  incomplete: boolean
  /** When the folder sizes were measured; null for a live measurement. */
  scannedAt: number | null
}

export type MachineDiskIndexLargestItem = {
  path: string
  bytes: number
  /** Files directly inside a folder; null for a file. */
  files: number | null
  mtimeMs: number | null
}

export type MachineDiskIndexLargest = {
  kind: 'files' | 'folders'
  items: MachineDiskIndexLargestItem[]
  scannedAt: number | null
}

export type MachineDiskIndexRequest =
  | { op: 'status' }
  | { op: 'list'; path: string }
  | { op: 'largest'; kind: 'files' | 'folders'; mount: string }
  /** Asks for an incremental scan now, e.g. after something was deleted. */
  | { op: 'rescan' }
  | { op: 'setMountIndexed'; mount: string; indexed: boolean }
  | { op: 'setProtectedFolders'; included: boolean }

export type MachineDiskIndexReply =
  | { ok: true; status: MachineDiskIndexStatus }
  | { ok: true; listing: MachineDiskIndexListing }
  | { ok: true; largest: MachineDiskIndexLargest }
  | { ok: false; message: string }

/** Entries returned for one folder; the rest are summed into `omittedBytes`. */
export const DISK_INDEX_MAX_LISTING_ENTRIES = 300
export const DISK_INDEX_MAX_LARGEST_ITEMS = 200
