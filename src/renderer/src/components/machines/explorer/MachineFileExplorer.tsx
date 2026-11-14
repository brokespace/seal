import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useOsFileDropOwner } from '@/hooks/use-os-file-drop-owner'
import { cn } from '@/lib/class-names'
import type { MachineFileEntry } from '../../../../../shared/machines/machine-types'
import { machinePathDirname } from '../../../../../shared/machines/machine-paths'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { MachineDeleteDialog } from './MachineDeleteDialog'
import { MachineExplorerMenu } from './MachineExplorerMenu'
import { MachineExplorerToolbar } from './MachineExplorerToolbar'
import { VirtualizedList } from '@/components/virtualized-list'
import {
  MACHINE_EXPLORER_ROW_HEIGHT,
  MachineExplorerRow,
  type MachineExplorerRowHandlers
} from './MachineExplorerRow'
import { MachineFilePreview } from './MachineFilePreview'
import { MachineGoToFolder } from './MachineGoToFolder'
import { MachinePromptDialog } from './MachinePromptDialog'
import type { ExplorerRow } from './machine-explorer-rows'
import type { MachineExplorerFileOps } from './machine-explorer-source'
import { useMachineExplorerTree } from './use-machine-explorer-tree'
import { useMachineFileActions } from './use-machine-file-actions'

type EntryRow = Extract<ExplorerRow, { type: 'entry' }>
type PreviewTarget = { path: string; entry: MachineFileEntry }

function dropDirFromTarget(target: EventTarget | null): string | null {
  const element = target instanceof Element ? target.closest('[data-machine-drop-dir]') : null
  return element?.getAttribute('data-machine-drop-dir') ?? null
}

export type MachineFolderRequest = { path: string; id: number }

export function MachineFileExplorer({
  machine,
  homeDir = null,
  hidden = false,
  folderRequest = null,
  startAt,
  fileOps
}: {
  machine: MachineSummary
  homeDir?: string | null
  /** Kept mounted behind a resource detail so the tree and its scroll position survive. */
  hidden?: boolean
  /** Another part of the page asking the tree to open a folder. */
  folderRequest?: MachineFolderRequest | null
  startAt?: string
  /** A tree scoped to one feature's files; it has no jump to arbitrary folders. */
  fileOps?: MachineExplorerFileOps
}): React.JSX.Element {
  const t = useTranslate()
  const online = machine.status === 'online'
  const isRemote = machine.connection !== 'local'
  const [showHidden, setShowHidden] = useState(false)
  const tree = useMachineExplorerTree(machine.id, online, showHidden, startAt)
  const { navigate, toggle, refresh, loadMore } = tree
  const actions = useMachineFileActions(machine.id, tree.refresh, fileOps)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [menuRow, setMenuRow] = useState<EntryRow | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const dropOwnerRef = useRef<HTMLElement | null>(null)
  const [handledRequest, setHandledRequest] = useState(folderRequest?.id ?? 0)
  if (folderRequest && folderRequest.id !== handledRequest) {
    setHandledRequest(folderRequest.id)
    navigate(folderRequest.path)
    setPreview(null)
  }

  const root = tree.root
  const attachDropOwner = useOsFileDropOwner<string | null>(dropOwnerRef, {
    kind: 'files',
    canAccept: root !== null,
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
      setPreview({ path: row.path, entry: row.entry })
    },
    [navigate]
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
      canDragOut: (row) => !row.entry.isDirectoryLike || machine.connection === 'local',
      onRetry: (path) => refresh(path),
      onLoadMore: (path) => loadMore(path)
    }),
    [isRemote, loadMore, machine.id, machine.connection, openEntry, refresh, toggle]
  )

  const selectedPaths = [...selected]
  const menuDir = menuRow
    ? menuRow.entry.isDirectoryLike
      ? menuRow.path
      : (machinePathDirname(menuRow.path) ?? menuRow.path)
    : root

  if (!online) {
    return (
      <div
        className={cn(
          'flex-1 items-center justify-center p-6 text-sm text-muted-foreground',
          hidden ? 'hidden' : 'flex'
        )}
      >
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
    <div
      className={cn('min-h-0 flex-1 flex-col', hidden ? 'hidden' : 'flex')}
      data-machine-explorer={machine.id}
    >
      <MachineExplorerToolbar
        root={root}
        isRemote={isRemote}
        showHidden={showHidden}
        onToggleHidden={() => setShowHidden((value) => !value)}
        navigate={navigate}
        refresh={() => refresh()}
        actions={actions}
      />
      {fileOps ? null : (
        <MachineGoToFolder
          machineId={machine.id}
          currentDir={root}
          homeDir={homeDir}
          onOpen={(path) => {
            navigate(path)
            setPreview(null)
          }}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <ContextMenu onOpenChange={(open) => !open && setMenuRow(null)}>
          <ContextMenuTrigger asChild>
            <div
              ref={(element) => {
                setScrollElement(element)
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
                if (event.dataTransfer.types.includes('Files')) {
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
                if (selectedPaths.length === 0) {
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
                <VirtualizedList
                  rows={tree.rows}
                  getRowKey={(row) => row.key}
                  scrollElement={scrollElement}
                  estimateRowHeightPx={MACHINE_EXPLORER_ROW_HEIGHT}
                  renderRow={(row) => (
                    <div key={row.key} style={{ height: MACHINE_EXPLORER_ROW_HEIGHT }}>
                      <MachineExplorerRow
                        row={row}
                        selected={row.type === 'entry' && selected.has(row.path)}
                        dropTarget={
                          row.type === 'entry' && row.entry.isDirectoryLike && dropDir === row.path
                        }
                        handlers={handlers}
                      />
                    </div>
                  )}
                />
              )}
            </div>
          </ContextMenuTrigger>
          <MachineExplorerMenu
            menuRow={menuRow}
            menuDir={menuDir}
            selectedPaths={selectedPaths}
            machineKind={machine.connection}
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
            onClose={() => setPreview(null)}
            onDownload={() => actions.download([preview.path])}
            readText={fileOps?.readText}
            writeFile={fileOps?.write}
          />
        ) : null}
      </div>
      <MachinePromptDialog request={actions.prompt} onClose={actions.closePrompt} />
      <MachineDeleteDialog
        paths={actions.pendingDelete}
        machineLabel={machine.label}
        description={fileOps?.removeDescription}
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
