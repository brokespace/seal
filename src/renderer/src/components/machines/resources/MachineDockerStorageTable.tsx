import React, { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import type {
  MachineDockerStorageKind,
  MachineDockerStoredContainer
} from '../../../../../shared/machines/machine-docker-types'
import { formatBytes } from '../model/machine-format'
import type { MachineDockerConfirmedAction } from './MachineDockerContainerDialog'
import { MachineDockerStateBadge } from './MachineDockerContainerRefs'
import { MachineDockerStorageContainerActions } from './MachineDockerStorageContainerActions'
import { MachineSortHeader } from './MachineSortHeader'
import { useMachineDockerStorageCopy } from './machine-docker-storage-copy'
import {
  dockerContainerExitCode,
  isDockerStorageItemReclaimable,
  shortDockerId,
  type MachineDockerStorageItem,
  type MachineDockerStorageSort
} from './machine-docker-storage-rows'

/** More rows than this are held back behind a button, so a host with thousands stays quick. */
const ROWS_SHOWN = 200

const SIZE_COLUMN = 'w-16 shrink-0 text-right'
const AGE_COLUMN = 'w-14 shrink-0 text-right @max-lg:hidden'
const COUNT_COLUMN = 'w-14 shrink-0 text-right @max-lg:hidden'
const TEXT_COLUMN = 'w-32 shrink-0 truncate text-left @max-2xl:hidden'
const DRIVER_COLUMN = 'w-14 shrink-0 truncate text-left @max-lg:hidden'
const NUMBER = 'font-mono tabular-nums'

// Formatter caches key on option identity, so this must be a module constant.
const WHEN_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }

type Column = {
  label: string
  sort?: MachineDockerStorageSort
  className: string
  cell: (item: MachineDockerStorageItem) => string
  /** The full value, where the cell abbreviates it. */
  title?: (item: MachineDockerStorageItem) => string | undefined
}

type Layout = {
  nameLabel: string
  columns: Column[]
  /** The muted second line. */
  detail: (item: MachineDockerStorageItem) => string
}

function age(at: number | null, now: number): string {
  return at === null ? '—' : formatShortTimeAgo(at, now)
}

function when(at: number | null): string | undefined {
  return at === null ? undefined : uiDateTimeFormat(WHEN_FORMAT).format(at)
}

function layoutOf(kind: MachineDockerStorageKind, t: Translate, now: number): Layout {
  const size: Column = {
    label: t('auto.components.machines.dockerStorage.column.size', 'Size'),
    sort: 'size',
    className: cn(SIZE_COLUMN, NUMBER),
    cell: (item) => formatBytes(item.sizeBytes)
  }
  const usedBy: Column = {
    label: t('auto.components.machines.dockerStorage.column.usedBy', 'Used by'),
    className: TEXT_COLUMN,
    cell: (item) => item.usedBy.join(', ') || '—',
    title: (item) => item.usedBy.join(', ') || undefined
  }
  const created: Column = {
    label: t('auto.components.machines.dockerStorage.column.created', 'Created'),
    sort: 'created',
    className: cn(AGE_COLUMN, NUMBER),
    cell: (item) => age(item.createdAt, now),
    title: (item) => when(item.createdAt)
  }
  switch (kind) {
    case 'images':
      return {
        nameLabel: t('auto.components.machines.dockerStorage.column.image', 'Image'),
        columns: [
          usedBy,
          created,
          size,
          {
            label: t('auto.components.machines.dockerStorage.column.frees', 'Frees'),
            sort: 'frees',
            className: cn(SIZE_COLUMN, NUMBER),
            cell: (item) => formatBytes(item.freesBytes)
          }
        ],
        detail: (item) =>
          item.kind === 'images'
            ? [shortDockerId(item.image.id), ...item.image.tags.slice(1)].join(' · ')
            : ''
      }
    case 'containers':
      return {
        nameLabel: t('auto.components.machines.dockerStorage.column.container', 'Container'),
        columns: [
          {
            label: t('auto.components.machines.dockerStorage.column.volumes', 'Volumes'),
            sort: 'volumes',
            className: cn(COUNT_COLUMN, NUMBER),
            cell: (item) => (item.kind === 'containers' ? `${item.container.volumes.length}` : ''),
            title: (item) =>
              item.kind === 'containers'
                ? item.container.volumes.join(', ') || undefined
                : undefined
          },
          created,
          size
        ],
        detail: (item) =>
          item.kind === 'containers' ? `${item.container.image} · ${item.container.status}` : ''
      }
    case 'volumes':
      return {
        nameLabel: t('auto.components.machines.dockerStorage.column.volume', 'Volume'),
        columns: [
          usedBy,
          {
            label: t('auto.components.machines.dockerStorage.column.driver', 'Driver'),
            sort: 'driver',
            className: DRIVER_COLUMN,
            cell: (item) => (item.kind === 'volumes' ? item.volume.driver : '')
          },
          size
        ],
        detail: (item) => (item.kind === 'volumes' ? item.volume.mountpoint : '')
      }
    case 'build-cache':
      return {
        nameLabel: t('auto.components.machines.dockerStorage.column.record', 'Record'),
        columns: [
          {
            label: t('auto.components.machines.dockerStorage.column.type', 'Type'),
            sort: 'type',
            className: TEXT_COLUMN,
            cell: (item) => (item.kind === 'build-cache' ? item.record.cacheType : '')
          },
          {
            label: t('auto.components.machines.dockerStorage.column.lastUsed', 'Last used'),
            sort: 'lastUsed',
            className: cn('w-16 shrink-0 text-right', NUMBER),
            cell: (item) => age(item.kind === 'build-cache' ? item.record.lastUsedAt : null, now),
            title: (item) => when(item.kind === 'build-cache' ? item.record.lastUsedAt : null)
          },
          size
        ],
        detail: (item) =>
          item.kind === 'build-cache' ? `${item.record.cacheType} · ${item.record.id}` : ''
      }
  }
}

/** Docker names an anonymous volume by a 64-character hash. */
function isHashName(name: string): boolean {
  return /^[0-9a-f]{64}$/.test(name)
}

function ItemName({
  item,
  opens
}: {
  item: MachineDockerStorageItem
  opens: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const untagged = item.kind === 'images' && item.image.reference === null
  const hash = item.kind === 'volumes' && isHashName(item.name)
  const className = cn(
    'min-w-12 truncate text-left font-medium',
    hash && 'font-mono font-normal',
    untagged && 'font-normal text-muted-foreground'
  )
  const text = untagged
    ? t('auto.components.machines.dockerStorage.untagged', '<untagged>')
    : hash
      ? `${item.name.slice(0, 12)}…`
      : item.name
  // The row carries the click; the button gives the keyboard the same way in.
  return opens ? (
    <button
      type="button"
      className={cn(
        className,
        'rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
      )}
      title={item.name}
    >
      {text}
    </button>
  ) : (
    <span className={className} title={item.name}>
      {text}
    </span>
  )
}

function stop(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

/** One kind of Docker object: two lines per item so names stay readable in a narrow pane. */
export function MachineDockerStorageTable({
  kind,
  items,
  now,
  sort,
  descending,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  starting,
  onStart,
  onAsk
}: {
  kind: MachineDockerStorageKind
  /** Already filtered and sorted. */
  items: readonly MachineDockerStorageItem[]
  /** When the inventory was read, which ages are counted from. */
  now: number
  sort: MachineDockerStorageSort
  descending: boolean
  onSort: (sort: MachineDockerStorageSort) => void
  selected: ReadonlySet<string>
  onToggle: (key: string) => void
  onToggleAll: (checked: boolean) => void
  /** Absent for kinds with nothing more to show. */
  onOpen?: (item: MachineDockerStorageItem) => void
  starting: ReadonlySet<string>
  onStart: (container: MachineDockerStoredContainer) => void
  onAsk: (container: MachineDockerStoredContainer, action: MachineDockerConfirmedAction) => void
}): React.JSX.Element {
  const t = useTranslate()
  const copy = useMachineDockerStorageCopy()
  const [all, setAll] = useState(false)
  const layout = layoutOf(kind, t, now)
  const shown = all ? items : items.slice(0, ROWS_SHOWN)
  const ticked = items.filter((item) => selected.has(item.key)).length
  return (
    <div className="text-xs" data-machine-docker-table={kind} data-sort={sort}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-3 py-1.5 text-2xs text-muted-foreground">
        <Checkbox
          aria-label={t('auto.components.machines.dockerStorage.selectAll', 'Select all shown')}
          checked={ticked === 0 ? false : ticked === items.length ? true : 'indeterminate'}
          onCheckedChange={(checked) => onToggleAll(checked === true)}
          data-machine-docker-select-all
        />
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <MachineSortHeader
            label={layout.nameLabel}
            active={sort === 'name'}
            descending={descending}
            className="shrink-0"
            onSort={() => onSort('name')}
          />
          <MachineSortHeader
            label={t('auto.components.machines.dockerStorage.column.status', 'Status')}
            active={sort === 'status'}
            descending={descending}
            className="shrink-0"
            onSort={() => onSort('status')}
          />
        </span>
        {layout.columns.map((column) =>
          column.sort ? (
            <MachineSortHeader
              key={column.label}
              label={column.label}
              active={sort === column.sort}
              descending={descending}
              // A header is a label, so it takes the column's width without its number face.
              className={cn(column.className, 'font-sans')}
              onSort={() => column.sort && onSort(column.sort)}
            />
          ) : (
            <span key={column.label} className={cn(column.className, 'font-medium')}>
              {column.label}
            </span>
          )
        )}
      </div>
      <ul>
        {shown.map((item) => {
          const container = item.kind === 'containers' ? item.container : null
          return (
            <li
              key={item.key}
              className={cn(
                'flex items-start gap-2 border-b border-border/60 px-3 py-1.5 last:border-b-0 hover:bg-accent/40',
                onOpen && 'cursor-pointer'
              )}
              data-machine-docker-row={item.key}
              data-status={item.status}
              data-selected={selected.has(item.key)}
              onClick={onOpen ? () => onOpen(item) : undefined}
            >
              <label className="-m-1.5 flex p-1.5" onClick={stop}>
                <Checkbox
                  aria-label={t(
                    'auto.components.machines.dockerStorage.select',
                    'Select {{name}}',
                    {
                      name: item.name
                    }
                  )}
                  checked={selected.has(item.key)}
                  onCheckedChange={() => onToggle(item.key)}
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <ItemName item={item} opens={onOpen !== undefined} />
                    {container ? (
                      <MachineDockerStateBadge
                        state={container.state}
                        exitCode={dockerContainerExitCode(container.status)}
                        dense
                      />
                    ) : (
                      <Badge
                        variant="referenceLabel"
                        // The badge gives way before the name does.
                        className="min-w-8 shrink-[4] justify-start"
                        title={copy.status(item)}
                        data-machine-docker-status={item.status}
                      >
                        <span
                          className={cn(
                            'truncate',
                            isDockerStorageItemReclaimable(item) && 'text-foreground'
                          )}
                        >
                          {copy.status(item)}
                        </span>
                      </Badge>
                    )}
                  </div>
                  {layout.columns.map((column) => (
                    <span
                      key={column.label}
                      className={column.className}
                      title={column.title?.(item)}
                    >
                      {column.cell(item)}
                    </span>
                  ))}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <div
                    className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground"
                    title={layout.detail(item)}
                  >
                    {layout.detail(item)}
                    {item.usedBy.length > 0 ? (
                      <span className="font-sans @2xl:hidden">
                        {` · ${t(
                          'auto.components.machines.dockerStorage.usedBy',
                          'used by {{names}}',
                          {
                            names: item.usedBy.join(', ')
                          }
                        )}`}
                      </span>
                    ) : null}
                  </div>
                  {container ? (
                    <MachineDockerStorageContainerActions
                      container={container}
                      starting={starting.has(container.id)}
                      onStart={() => onStart(container)}
                      onAsk={(action) => onAsk(container, action)}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {items.length > shown.length ? (
        <div className="border-t border-border/60 px-3 py-1.5">
          <Button type="button" variant="ghost" size="xs" onClick={() => setAll(true)}>
            {t('auto.components.machines.dockerStorage.showAll', 'Show all {{count}}', {
              count: items.length
            })}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
