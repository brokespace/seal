import React from 'react'
import { Loader2 } from 'lucide-react'
import { PageCard } from '@/components/page-layout/PageCard'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineDiskIndexMount,
  MachineDiskIndexSkipReason,
  MachineDiskIndexStatus
} from '../../../../../shared/machines/machine-disk-index-types'
import { formatBytes, formatCount, formatUptime } from '../model/machine-format'
import type { MachineDiskIndexState } from './use-machine-disk-index'

function useMountNote(): (mount: MachineDiskIndexMount, status: MachineDiskIndexStatus) => string {
  const t = useTranslate()
  const skipped: Record<MachineDiskIndexSkipReason, string> = {
    network: t('auto.components.machines.disk.index.network', 'Network disk, not indexed.'),
    removable: t('auto.components.machines.disk.index.removable', 'Removable disk, not indexed.'),
    excluded: t('auto.components.machines.disk.index.excluded', 'Left out of the index.'),
    virtual: t('auto.components.machines.disk.index.virtual', 'Not a real disk, not indexed.')
  }
  return (mount, status) => {
    if (!mount.indexed) {
      return mount.skipReason ? skipped[mount.skipReason] : ''
    }
    if (mount.scannedAt === null) {
      return status.scan?.mount === mount.mount
        ? t('auto.components.machines.disk.index.firstScan', 'First scan in progress.')
        : t('auto.components.machines.disk.index.waiting', 'Waiting for its first scan.')
    }
    const parts = [
      t('auto.components.machines.disk.index.age', 'Indexed {{age}} ago', {
        age: formatUptime(Math.max(0, (status.now - mount.scannedAt) / 1000))
      }),
      t('auto.components.machines.disk.index.files', '{{formatted}} files', {
        formatted: formatCount(mount.indexedFiles ?? 0)
      })
    ]
    if (mount.unreadableFolders > 0) {
      parts.push(
        t(
          'auto.components.machines.disk.index.unreadable',
          '{{formatted}} folders could not be read',
          { formatted: formatCount(mount.unreadableFolders) }
        )
      )
    }
    return parts.join(' · ')
  }
}

function IndexActivity({ status }: { status: MachineDiskIndexStatus }): React.JSX.Element | null {
  const t = useTranslate()
  const scan = status.scan
  if (scan) {
    const known = scan.expectedFolders
    const percent =
      known && known > 0 ? Math.min(99, Math.floor((scan.folders / known) * 100)) : null
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground"
        data-machine-disk-scan={scan.mode}
      >
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="truncate">
          {percent === null
            ? t(
                'auto.components.machines.disk.index.scanning',
                'Scanning {{mount}}: {{files}} files, {{size}} so far',
                {
                  mount: scan.mount,
                  files: formatCount(scan.files),
                  size: formatBytes(scan.bytes)
                }
              )
            : t(
                'auto.components.machines.disk.index.rescanning',
                'Checking {{mount}} for changes: {{percent}}%',
                { mount: scan.mount, percent }
              )}
        </span>
      </span>
    )
  }
  if (status.source === 'live' || status.nextScanAt === null) {
    return null
  }
  return (
    <span className="truncate text-2xs text-muted-foreground">
      {t('auto.components.machines.disk.index.next', 'Checks for changes again in {{time}}', {
        time: formatUptime(Math.max(0, (status.nextScanAt - status.now) / 1000))
      })}
    </span>
  )
}

function MountRow({
  mount,
  note,
  active,
  canToggle,
  onOpen,
  onToggle
}: {
  mount: MachineDiskIndexMount
  note: string
  active: boolean
  canToggle: boolean
  onOpen: () => void
  onToggle: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const percent = mount.totalBytes > 0 ? (mount.usedBytes / mount.totalBytes) * 100 : 0
  const tone =
    percent >= 90 ? 'bg-destructive' : percent >= 75 ? 'bg-status-warning' : 'bg-foreground/60'
  return (
    <li className={cn('flex items-center gap-2 px-1.5 py-1', active && 'bg-accent/40')}>
      <button
        type="button"
        aria-pressed={active}
        className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent/40"
        onClick={onOpen}
      >
        <span className="min-w-0 truncate">
          <span className="font-mono font-medium">{mount.mount}</span>
          <span className="ml-2 text-2xs text-muted-foreground">
            {mount.fsType ? `${mount.filesystem} · ${mount.fsType}` : mount.filesystem}
          </span>
        </span>
        <span className="font-mono whitespace-nowrap tabular-nums">
          {`${formatBytes(mount.usedBytes)} / ${formatBytes(mount.totalBytes)}`}
          <span className="ml-2 text-muted-foreground">
            {t('auto.components.machines.disk.free', '{{size}} free', {
              size: formatBytes(mount.availableBytes)
            })}
          </span>
        </span>
        <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <span
            className={cn('block h-full rounded-full', tone)}
            style={{ width: `${percent}%` }}
          />
        </span>
        {note ? (
          <span className="col-span-2 truncate text-2xs text-muted-foreground">{note}</span>
        ) : null}
      </button>
      {canToggle ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={onToggle}
          data-machine-disk-index-toggle={mount.mount}
        >
          {mount.indexed
            ? t('auto.components.machines.disk.index.exclude', 'Stop indexing')
            : t('auto.components.machines.disk.index.include', 'Index this disk')}
        </Button>
      ) : null}
    </li>
  )
}

/** A machine's disks with how full they are, and how current the background index of each is. */
export function MachineDiskMountsCard({
  index,
  activeMount,
  onOpen
}: {
  index: MachineDiskIndexState
  activeMount: string | null
  onOpen: (mount: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const note = useMountNote()
  const { status, error } = index
  const unavailable =
    status?.source !== 'live'
      ? null
      : status.unavailableReason === 'no-node'
        ? t(
            'auto.components.machines.disk.index.noNode',
            'This machine has no Node.js 20 or newer, so there is no background index: folders are measured when you open them, which is slow on big disks.'
          )
        : t(
            'auto.components.machines.disk.index.failed',
            'The background index could not be started on this machine, so folders are measured when you open them.'
          )
  return (
    <PageCard
      title={t('auto.components.machines.disk.mounts', 'Disks')}
      action={status ? <IndexActivity status={status} /> : null}
    >
      {error ? (
        <p className="px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {error}
        </p>
      ) : null}
      <ul
        className="divide-y divide-border/60"
        data-machine-disk-mounts={status ? status.source : 'loading'}
      >
        {(status?.mounts ?? []).map((mount) => (
          <MountRow
            key={mount.mount}
            mount={mount}
            note={status ? note(mount, status) : ''}
            active={activeMount === mount.mount}
            // The disk the system lives on is always indexed; the choice is for the others.
            canToggle={status?.source === 'index' && mount.mount !== '/'}
            onOpen={() => onOpen(mount.mount)}
            onToggle={() =>
              void index.send({
                op: 'setMountIndexed',
                mount: mount.mount,
                indexed: !mount.indexed
              })
            }
          />
        ))}
      </ul>
      {status === null && !error ? (
        <div className="flex h-12 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}
      {unavailable ? (
        <p className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
          {unavailable}
        </p>
      ) : null}
      {status?.protectedFoldersSkipped ? (
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-2xs text-muted-foreground">
          <span className="min-w-0 flex-1">
            {t(
              'auto.components.machines.disk.index.protected',
              'Desktop, Documents, Downloads and iCloud folders are left out, because reading them makes macOS ask for permission.'
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="shrink-0"
            onClick={() => void index.send({ op: 'setProtectedFolders', included: true })}
          >
            {t('auto.components.machines.disk.index.includeProtected', 'Include them')}
          </Button>
        </div>
      ) : null}
    </PageCard>
  )
}
