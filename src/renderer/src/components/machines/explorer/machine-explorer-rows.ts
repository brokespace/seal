import type { MachineFileEntry } from '../../../../../shared/machines/machine-types'
import { joinMachinePath } from '../../../../../shared/machines/machine-paths'

export type FolderState = {
  entries: MachineFileEntry[]
  totalEntries: number
  loading: boolean
  error: string | null
}

export type ExplorerRow =
  | {
      type: 'entry'
      key: string
      path: string
      depth: number
      entry: MachineFileEntry
      expanded: boolean
    }
  | { type: 'loading'; key: string; depth: number }
  | { type: 'error'; key: string; path: string; depth: number; message: string }
  | { type: 'more'; key: string; path: string; depth: number; remaining: number }

export function shouldShowEntry(entry: MachineFileEntry, showHidden: boolean): boolean {
  return showHidden || !entry.name.startsWith('.')
}

/** Flattens the expanded tree under `root` into virtual-list rows, depth-first. */
export function flattenExplorerRows(
  root: string,
  folders: ReadonlyMap<string, FolderState>,
  expanded: ReadonlySet<string>,
  showHidden: boolean
): ExplorerRow[] {
  const rows: ExplorerRow[] = []
  const visit = (dir: string, depth: number): void => {
    const folder = folders.get(dir)
    if (!folder || (folder.loading && folder.entries.length === 0)) {
      rows.push({ type: 'loading', key: `${dir}\0loading`, depth })
      return
    }
    if (folder.error && folder.entries.length === 0) {
      rows.push({ type: 'error', key: `${dir}\0error`, path: dir, depth, message: folder.error })
      return
    }
    for (const entry of folder.entries) {
      if (!shouldShowEntry(entry, showHidden)) {
        continue
      }
      const path = joinMachinePath(dir, entry.name)
      const isExpanded = entry.isDirectoryLike && expanded.has(path)
      rows.push({ type: 'entry', key: path, path, depth, entry, expanded: isExpanded })
      if (isExpanded) {
        visit(path, depth + 1)
      }
    }
    const remaining = folder.totalEntries - folder.entries.length
    if (remaining > 0) {
      rows.push({ type: 'more', key: `${dir}\0more`, path: dir, depth, remaining })
    }
  }
  visit(root, 0)
  return rows
}
