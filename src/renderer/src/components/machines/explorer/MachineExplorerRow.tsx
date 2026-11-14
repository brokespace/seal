import React from 'react'
import { ChevronRight, File, FileSymlink, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { getIntlLocale } from '@/i18n/i18n'
import { cn } from '@/lib/class-names'
import { machinePathDirname } from '../../../../../shared/machines/machine-paths'
import { formatBytes } from '../model/machine-format'
import type { ExplorerRow } from './machine-explorer-rows'

export const MACHINE_EXPLORER_ROW_HEIGHT = 26
const INDENT_PX = 14

export type MachineExplorerRowHandlers = {
  onClick: (row: Extract<ExplorerRow, { type: 'entry' }>, event: React.MouseEvent) => void
  onDoubleClick: (row: Extract<ExplorerRow, { type: 'entry' }>) => void
  onContextMenu: (row: Extract<ExplorerRow, { type: 'entry' }>) => void
  onMouseDown: (row: Extract<ExplorerRow, { type: 'entry' }>, event: React.MouseEvent) => void
  onDragStart: (row: Extract<ExplorerRow, { type: 'entry' }>, event: React.DragEvent) => void
  canDragOut: (row: Extract<ExplorerRow, { type: 'entry' }>) => boolean
  onRetry: (path: string) => void
  onLoadMore: (path: string) => void
}

function formatModified(mtimeMs: number | null): string {
  if (mtimeMs === null) {
    return ''
  }
  return new Date(mtimeMs).toLocaleString(getIntlLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export const MachineExplorerRow = React.memo(function MachineExplorerRow({
  row,
  selected,
  dropTarget,
  handlers
}: {
  row: ExplorerRow
  selected: boolean
  dropTarget: boolean
  handlers: MachineExplorerRowHandlers
}): React.JSX.Element {
  const t = useTranslate()
  const padding = { paddingLeft: 8 + row.depth * INDENT_PX }
  if (row.type === 'loading') {
    return (
      <div className="flex h-full items-center gap-2 text-xs text-muted-foreground" style={padding}>
        <Loader2 className="size-3 animate-spin" />
        {t('auto.components.machines.explorer.loading', 'Loading…')}
      </div>
    )
  }
  if (row.type === 'error') {
    return (
      <div className="flex h-full min-w-0 items-center gap-2 text-xs" style={padding}>
        <span className="min-w-0 truncate text-destructive" title={row.message}>
          {row.message}
        </span>
        <button
          type="button"
          className="shrink-0 text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => handlers.onRetry(row.path)}
        >
          {t('auto.components.machines.explorer.retry', 'Retry')}
        </button>
      </div>
    )
  }
  if (row.type === 'more') {
    return (
      <div className="flex h-full items-center" style={padding}>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => handlers.onLoadMore(row.path)}
        >
          {t('auto.components.machines.explorer.more', 'Show {{count}} more', {
            count: row.remaining
          })}
        </button>
      </div>
    )
  }

  const { entry } = row
  const isDir = entry.isDirectoryLike
  const Icon = isDir
    ? row.expanded
      ? FolderOpen
      : Folder
    : entry.kind === 'symlink'
      ? FileSymlink
      : File
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isDir ? row.expanded : undefined}
      data-machine-drop-dir={isDir ? row.path : (machinePathDirname(row.path) ?? row.path)}
      draggable={handlers.canDragOut(row)}
      className={cn(
        'flex h-full min-w-0 cursor-default items-center gap-1.5 pr-3 text-[13px] select-none',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        dropTarget && 'bg-accent ring-1 ring-ring ring-inset'
      )}
      style={padding}
      title={row.path}
      onClick={(event) => handlers.onClick(row, event)}
      onDoubleClick={() => handlers.onDoubleClick(row)}
      onContextMenu={() => handlers.onContextMenu(row)}
      onMouseDown={(event) => handlers.onMouseDown(row, event)}
      onDragStart={(event) => handlers.onDragStart(row, event)}
    >
      <ChevronRight
        className={cn(
          'size-3 shrink-0 text-muted-foreground transition-transform',
          !isDir && 'invisible',
          row.expanded && 'rotate-90'
        )}
      />
      <Icon
        className={cn('size-4 shrink-0', isDir ? 'text-foreground/80' : 'text-muted-foreground')}
      />
      <span className={cn('min-w-0 flex-1 truncate', entry.name.startsWith('.') && 'opacity-60')}>
        {entry.name}
      </span>
      <span className="hidden w-20 shrink-0 text-right font-mono text-2xs text-muted-foreground tabular-nums sm:block">
        {isDir ? '' : formatBytes(entry.size)}
      </span>
      <span className="hidden w-36 shrink-0 truncate text-right text-2xs text-muted-foreground lg:block">
        {formatModified(entry.mtimeMs)}
      </span>
    </div>
  )
})
