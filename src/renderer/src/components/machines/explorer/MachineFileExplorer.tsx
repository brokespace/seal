import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useOsFileDropOwner } from '@/hooks/use-os-file-drop-owner'
import { cn } from '@/lib/class-names'
import type { MachineFileEntry } from '../../../../../shared/machines/machine-types'
import { machinePathDirname } from '../../../../../shared/machines/machine-paths'
import type { MachineSummary } from '../model/machine-summaries'
import { MachineDeleteDialog } from './MachineDeleteDialog'
import { MachineExplorerMenu } from './MachineExplorerMenu'
import { MachineExplorerToolbar } from './MachineExplorerToolbar'
import type { MachineExplorerRowHandlers } from './MachineExplorerRow'
import { MachineExplorerVirtualRows } from './MachineExplorerVirtualRows'
import { MachineFilePreview } from './MachineFilePreview'
import { MachinePromptDialog } from './MachinePromptDialog'
import type { ExplorerRow } from './machine-explorer-rows'
import { useMachineExplorerTree } from './use-machine-explorer-tree'
import { useMachineFileActions } from './use-machine-file-actions'

type EntryRow = Extract<ExplorerRow, { type: 'entry' }>
type PreviewTarget = { path: string; entry: MachineFileEntry }

function dropDirFromTarget(target: EventTarget | null): string | null {
  const element = target instanceof Element ? target.closest('[data-machine-drop-dir]') : null
  return element?.getAttribute('data-machine-drop-dir') ?? null
}

export function MachineFileExplorer({ machine }: { machine: MachineSummary }): React.JSX.Element {
  const t = useTranslate()
  const online = machine.status === 'online'
  const writable = machine.browseMode === 'full'
  const isRemote = machine.kind !== 'local'
  const [showHidden, setShowHidden] = useState(false)
  const tree = useMachineExplorerTree(machine.id, online, showHidden)
  const { navigate, toggle, refresh, loadMore } = tree
  const actions = useMachineFileActions(machine.id, tree.refresh)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [menuRow, setMenuRow] = useState<EntryRow | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dropOwnerRef = useRef<HTMLElement | null>(null)

  const root = tree.root
  const attachDropOwner = useOsFileDropOwner<string | null>(dropOwnerRef, {
    kind: 'files',
    canAccept: writable && root !== null,
    captureDestination: (event) => dropDirFromTarget(event.target) ?? root,
    onFiles: (files, context) => {
      setDropDir(null)
      const destDir = context.destination
      const getPathForFile = window.api.fs.getPathForFile
      if (!destDir || !getPathForFile) {
        return
      }
      const localPaths = files.flatMap((file) => {
        try {
          const path = getPathForFile(file)
          return path ? [path] : []
        } catch {
          return []
        }
      })
      if (localPaths.length < files.length) {
        toast.error(
          t(
            'auto.components.machines.explorer.unresolvedDrop',
            'Some dropped items have no local file.'
          )
        )
      }
      actions.uploadPaths(localPaths, destDir)
    }
  })

  const openEntry = useCallback(
    (row: EntryRow) => {
      if (row.entry.isDirectoryLike) {
        navigate(row.path)
        setPreview(null)
        return
      }
      if (machine.kind === 'runtime') {
        toast.message(
          t(
            'auto.components.machines.explorer.runtimePreview',
            'Previews for runtime machines are not available yet.'
          )
        )
        return
      }
      setPreview({ path: row.path, entry: row.entry })
    },
    [machine.kind, navigate, t]
  )

  const handlers = useMemo<MachineExplorerRowHandlers>(
    () => ({
      onClick: (row, event) => {
        if (event.metaKey || event.ctrlKey) {
          setSelected((previous) => {
            const next = new Set(previous)
            if (next.has(row.path)) {
              next.delete(row.path)
            } else {
              next.add(row.path)
            }
            return next
          })
          return
        }
        setSelected(new Set([row.path]))
        if (row.entry.isDirectoryLike) {
          toggle(row.path)
        } else {
          openEntry(row)
        }
      },
      onDoubleClick: (row) => {
        if (row.entry.isDirectoryLike) {
          openEntry(row)
        }
      },
      onContextMenu: (row) => {
        setMenuRow(row)
        setSelected((previous) => (previous.has(row.path) ? previous : new Set([row.path])))
      },
      onMouseDown: (row, event) => {
        // Staging starts on press so the copy is usually local before the drag begins.
        if (event.button === 0 && isRemote && !row.entry.isDirectoryLike) {
          window.api.machines?.startDrag({
            machineId: machine.id,
            path: row.path,
            size: row.entry.size,
            prepare: true
          })
        }
      },
      onDragStart: (row, event) => {
        event.preventDefault()
        window.api.machines?.startDrag({
          machineId: machine.id,
          path: row.path,
          size: row.entry.size
        })
      },
      canDragOut: (row) =>
        machine.kind !== 'runtime' && (!row.entry.isDirectoryLike || machine.kind === 'local'),
      onRetry: (path) => refresh(path),
      onLoadMore: (path) => loadMore(path)
    }),
    [isRemote, loadMore, machine.id, machine.kind, openEntry, refresh, toggle]
  )

  const selectedPaths = [...selected]
  const menuDir = menuRow
    ? menuRow.entry.isDirectoryLike
      ? menuRow.path
      : (machinePathDirname(menuRow.path) ?? menuRow.path)
    : root

  if (!online) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {machine.status === 'connecting'
          ? t('auto.components.machines.explorer.connecting', 'Connecting…')
          : t(
              'auto.components.machines.explorer.offline',
              'Connect to this machine to browse its files.'
            )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-machine-explorer={machine.id}>
      <MachineExplorerToolbar
        root={root}
        writable={writable}
        isRemote={isRemote}
        showHidden={showHidden}
        onToggleHidden={() => setShowHidden((value) => !value)}
        navigate={navigate}
        refresh={() => refresh()}
        actions={actions}
      />
      <div className="flex min-h-0 flex-1">
        <ContextMenu onOpenChange={(open) => !open && setMenuRow(null)}>
          <ContextMenuTrigger asChild>
            <div
              ref={(element) => {
                scrollRef.current = element
                attachDropOwner(element)
              }}
              role="tree"
              aria-multiselectable
              className={cn(
                'scrollbar-sleek relative min-h-0 min-w-0 overflow-auto outline-none',
                preview ? 'w-[min(26rem,45%)] shrink-0 border-r border-border' : 'flex-1',
                dropDir !== null && dropDir === root && 'bg-accent/40'
              )}
              tabIndex={0}
              onDragEnter={(event) => {
                if (writable && event.dataTransfer.types.includes('Files')) {
                  setDropDir(dropDirFromTarget(event.target) ?? root)
                }
              }}
              onDragLeave={(event) => {
                if (
                  !(
                    event.relatedTarget instanceof Node &&
                    event.currentTarget.contains(event.relatedTarget)
                  )
                ) {
                  setDropDir(null)
                }
              }}
              onKeyDown={(event) => {
                if (!writable || selectedPaths.length === 0) {
                  return
                }
                if (event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey)) {
                  event.preventDefault()
                  actions.requestDelete(selectedPaths)
                } else if (event.key === 'F2' && selectedPaths.length === 1 && selectedPaths[0]) {
                  event.preventDefault()
                  actions.rename(selectedPaths[0])
                }
              }}
            >
              {tree.rootError ? (
                <p className="p-4 text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
                  {tree.rootError}
                </p>
              ) : root === null ? (
                <div className="flex h-24 items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : tree.rows.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  {t('auto.components.machines.explorer.empty', 'This folder is empty.')}
                </p>
              ) : (
                <MachineExplorerVirtualRows
                  rows={tree.rows}
                  scrollRef={scrollRef}
                  selected={selected}
                  dropDir={dropDir}
                  handlers={handlers}
                />
              )}
            </div>
          </ContextMenuTrigger>
          <MachineExplorerMenu
            menuRow={menuRow}
            menuDir={menuDir}
            selectedPaths={selectedPaths}
            writable={writable}
            machineKind={machine.kind}
            onOpen={openEntry}
            actions={actions}
          />
        </ContextMenu>
        {preview ? (
          <MachineFilePreview
            key={preview.path}
            machineId={machine.id}
            path={preview.path}
            entry={preview.entry}
            writable={writable}
            onClose={() => setPreview(null)}
            onDownload={() => actions.download([preview.path])}
          />
        ) : null}
      </div>
      <MachinePromptDialog request={actions.prompt} onClose={actions.closePrompt} />
      <MachineDeleteDialog
        paths={actions.pendingDelete}
        machineLabel={machine.label}
        onConfirm={async (paths) => {
          await actions.confirmDelete(paths)
          setSelected(new Set())
          if (preview && paths.some((path) => preview.path.startsWith(path))) {
            setPreview(null)
          }
        }}
        onClose={actions.closeDelete}
      />
    </div>
  )
}
