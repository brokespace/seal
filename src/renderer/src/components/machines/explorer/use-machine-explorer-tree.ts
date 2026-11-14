import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { listMachineDirectory } from './machine-explorer-source'
import { flattenExplorerRows, type ExplorerRow, type FolderState } from './machine-explorer-rows'

type MachineTreeMemory = {
  root: string | null
  expanded: Set<string>
  folders: Map<string, FolderState>
}

// Survives page switches so reopening a machine paints its last tree instantly.
const memory = new Map<string, MachineTreeMemory>()

function memoryFor(machineId: MachineId, startAt: string | undefined): MachineTreeMemory {
  const key = startAt ? `${machineId}\n${startAt}` : machineId
  let entry = memory.get(key)
  if (!entry) {
    entry = { root: startAt ?? null, expanded: new Set(), folders: new Map() }
    memory.set(key, entry)
  }
  return entry
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type MachineExplorerTree = {
  root: string | null
  rows: ExplorerRow[]
  expanded: ReadonlySet<string>
  folders: ReadonlyMap<string, FolderState>
  rootError: string | null
  navigate: (path: string | null) => void
  toggle: (path: string) => void
  refresh: (path?: string) => void
  loadMore: (path: string) => void
}

/** Callers key the owning component by machine id, so state never carries across machines. */
export function useMachineExplorerTree(
  machineId: MachineId,
  online: boolean,
  showHidden: boolean,
  /** Opens on this folder instead of the home folder, with its own remembered tree. */
  startAt?: string
): MachineExplorerTree {
  const remembered = memoryFor(machineId, startAt)
  const [root, setRoot] = useState<string | null>(remembered.root)
  const [expanded, setExpanded] = useState<Set<string>>(remembered.expanded)
  const [folders, setFolders] = useState<Map<string, FolderState>>(remembered.folders)
  const [rootError, setRootError] = useState<string | null>(null)
  const foldersRef = useRef(folders)
  const expandedRef = useRef(expanded)
  useLayoutEffect(() => {
    foldersRef.current = folders
    expandedRef.current = expanded
  })

  useEffect(() => {
    const entry = memoryFor(machineId, startAt)
    entry.root = root
    entry.expanded = expanded
    entry.folders = folders
  }, [machineId, startAt, root, expanded, folders])

  const patchFolder = useCallback((path: string, patch: Partial<FolderState>) => {
    setFolders((previous) => {
      const current = previous.get(path) ?? {
        entries: [],
        totalEntries: 0,
        loading: false,
        error: null
      }
      return new Map(previous).set(path, { ...current, ...patch })
    })
  }, [])

  const load = useCallback(
    async (path: string, options: { force?: boolean; append?: boolean } = {}) => {
      patchFolder(path, { loading: true })
      const offset = options.append ? (foldersRef.current.get(path)?.entries.length ?? 0) : 0
      try {
        const listing = await listMachineDirectory(machineId, path, {
          force: options.force,
          offset
        })
        setFolders((previous) => {
          const current = previous.get(path)
          const entries =
            options.append && current ? [...current.entries, ...listing.entries] : listing.entries
          return new Map(previous).set(path, {
            entries,
            totalEntries: listing.totalEntries,
            loading: false,
            error: null
          })
        })
      } catch (error) {
        patchFolder(path, { loading: false, error: errorText(error) })
      }
    },
    [machineId, patchFolder]
  )

  // Resolve the home folder first; listings answer with the absolute path they read.
  useEffect(() => {
    if (!online || root !== null) {
      return
    }
    let cancelled = false
    void listMachineDirectory(machineId, null)
      .then((listing) => {
        if (cancelled) {
          return
        }
        setFolders((previous) =>
          new Map(previous).set(listing.path, {
            entries: listing.entries,
            totalEntries: listing.totalEntries,
            loading: false,
            error: null
          })
        )
        setRoot(listing.path)
      })
      .catch((error) => {
        if (!cancelled) {
          setRootError(errorText(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [machineId, online, root])

  // Revalidate the visible tree whenever the machine (re)connects or the root changes.
  useEffect(() => {
    if (!online || root === null) {
      return
    }
    void load(root)
    // Only connect/root changes revalidate everything; expanding loads its own folder.
    for (const dir of expandedRef.current) {
      void load(dir)
    }
  }, [online, root, load])

  useEffect(() => {
    const api = window.api.machines
    if (!api) {
      return
    }
    return api.onDirChanged((event) => {
      if (event.machineId === machineId && foldersRef.current.has(event.path)) {
        void load(event.path)
      }
    })
  }, [machineId, load])

  const watchKey = root && online ? [root, ...expanded].join('\n') : ''
  useEffect(() => {
    const api = window.api.machines
    if (!api) {
      return
    }
    const dirs = watchKey ? watchKey.split('\n') : []
    void api.watchDirs({ machineId, dirs }).catch(() => {})
    return () => {
      void api.watchDirs({ machineId, dirs: [] }).catch(() => {})
    }
  }, [machineId, watchKey])

  const navigate = useCallback((path: string | null) => {
    setRootError(null)
    setExpanded(new Set())
    setRoot(path)
  }, [])

  const toggle = useCallback(
    (path: string) => {
      const opening = !expandedRef.current.has(path)
      setExpanded((previous) => {
        const next = new Set(previous)
        if (opening) {
          next.add(path)
        } else {
          next.delete(path)
        }
        return next
      })
      // Cached or prefetched folders paint at once; main revalidates them in the background.
      if (opening) {
        void load(path)
      }
    },
    [load]
  )

  const refresh = useCallback(
    (path?: string) => {
      const targets = path ? [path] : root ? [root, ...expanded] : []
      for (const dir of targets) {
        void load(dir, { force: true })
      }
    },
    [load, root, expanded]
  )

  const loadMore = useCallback((path: string) => void load(path, { append: true }), [load])

  const rows = useMemo(
    () => (root ? flattenExplorerRows(root, folders, expanded, showHidden) : []),
    [root, folders, expanded, showHidden]
  )

  return { root, rows, expanded, folders, rootError, navigate, toggle, refresh, loadMore }
}
