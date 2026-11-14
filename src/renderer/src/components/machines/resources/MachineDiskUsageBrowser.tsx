import React, { useEffect, useState } from 'react'
import { ArrowUp, File, Folder, FolderOpen, Link2, Loader2, Trash2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineDiskIndexEntry,
  MachineDiskIndexListing
} from '../../../../../shared/machines/machine-disk-index-types'
import { machinePathDirname } from '../../../../../shared/machines/machine-paths'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { MachineDeleteDialog } from '../explorer/MachineDeleteDialog'
import { MachinePathCrumbs } from '../explorer/MachinePathCrumbs'
import { formatBytes, formatUptime } from '../model/machine-format'
import { MachineDiskRowAction } from './MachineDiskRowAction'
import {
  machineResourceApi,
  requestDiskIndexListing,
  resourceErrorText
} from './machine-resource-requests'

const ENTRY_ICON: Record<MachineDiskIndexEntry['kind'], React.JSX.Element> = {
  directory: <Folder className="size-3.5 shrink-0 text-muted-foreground" />,
  file: <File className="size-3.5 shrink-0 text-muted-foreground" />,
  symlink: <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
}

function EntrySize({ entry }: { entry: MachineDiskIndexEntry }): React.JSX.Element {
  const t = useTranslate()
  if (entry.bytes !== null) {
    return <>{formatBytes(entry.bytes)}</>
  }
  return (
    <span className="font-sans text-2xs text-muted-foreground">
      {entry.unreadable
        ? t('auto.components.machines.disk.entry.unreadable', 'no access')
        : entry.notIndexed
          ? t('auto.components.machines.disk.entry.notIndexed', 'not indexed')
          : t('auto.components.machines.disk.entry.pending', 'not measured yet')}
    </span>
  )
}

/**
 * What is taking space under a folder, largest first; folders open to show what is inside them.
 * Folder sizes come from the machine's index, so a folder opens without being measured again.
 */
export function MachineDiskUsageBrowser({
  machine,
  path,
  generation,
  now,
  onPath,
  onReveal,
  onDeleted
}: {
  machine: MachineSummary
  path: string
  /** Changes when the index does, which is when a shown listing is out of date. */
  generation: number
  /** The machine's clock, to age the index. */
  now: number
  onPath: (path: string) => void
  onReveal: (folder: string) => void
  onDeleted: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const machineId = machine.id
  const [listing, setListing] = useState<MachineDiskIndexListing | null>(null)
  const [error, setError] = useState<{ path: string; message: string } | null>(null)
  const [reload, setReload] = useState(0)
  const [deleting, setDeleting] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void requestDiskIndexListing(machineId, path)
      .then((result) => {
        if (!cancelled) {
          setListing(result)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        // Opening another folder cancels this request on the machine; that is not a failure to show.
        if (!cancelled) {
          setError({ path, message: resourceErrorText(err) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [machineId, path, generation, reload])

  // The previous folder stays up until the next one answers, so drilling in never blanks the list.
  const shown = listing?.path === path ? listing : null
  const parent = machinePathDirname(path)
  const largest = shown?.entries.reduce((max, entry) => Math.max(max, entry.bytes ?? 0), 0) ?? 0
  const failed = error?.path === path ? error.message : null
  const notes = shown
    ? [
        shown.omittedCount > 0
          ? t(
              'auto.components.machines.disk.omitted',
              '{{count}} smaller items ({{size}}) are not listed.',
              {
                count: shown.omittedCount,
                size: formatBytes(shown.omittedBytes),
                defaultValue_one: '{{count}} smaller item ({{size}}) is not listed.'
              }
            )
          : null,
        shown.incomplete
          ? t(
              'auto.components.machines.disk.incomplete',
              'Some folders could not be read, so the real total is larger.'
            )
          : null,
        shown.scannedAt !== null
          ? t(
              'auto.components.machines.disk.listingAge',
              'Folder sizes are from the index, {{age}} old. Files are listed as they are now.',
              { age: formatUptime(Math.max(0, (now - shown.scannedAt) / 1000)) }
            )
          : null
      ].filter(Boolean)
    : []

  return (
    <div data-machine-disk-usage={shown ? path : 'loading'}>
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <MachineDiskRowAction
          label={t('auto.components.machines.disk.up', 'Parent folder')}
          onClick={() => parent && onPath(parent)}
        >
          <ArrowUp />
        </MachineDiskRowAction>
        <MachinePathCrumbs
          path={path}
          label={t('auto.components.machines.disk.path', 'Folder being sized')}
          onOpen={onPath}
        />
        <span className="shrink-0 px-2 font-mono text-xs tabular-nums">
          {shown && shown.totalBytes !== null ? formatBytes(shown.totalBytes) : ''}
        </span>
        <MachineDiskRowAction
          label={t('auto.components.machines.disk.reveal', 'Show in files')}
          onClick={() => onReveal(path)}
        >
          <FolderOpen />
        </MachineDiskRowAction>
      </div>
      {failed ? (
        <p className="px-3 py-3 text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {failed}
        </p>
      ) : shown === null ? (
        <div className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('auto.components.machines.disk.loading', 'Reading this folder…')}
        </div>
      ) : shown.entries.length === 0 ? (
        <p className="px-3 py-6 text-xs text-muted-foreground">
          {t('auto.components.machines.disk.empty', 'This folder is empty.')}
        </p>
      ) : (
        <ul>
          {shown.entries.map((entry) => (
            <li
              key={entry.path}
              className="group flex items-center gap-2 border-b border-border/60 pr-1.5 text-xs last:border-b-0 hover:bg-accent/40"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left disabled:cursor-default"
                disabled={entry.kind !== 'directory'}
                onClick={() => onPath(entry.path)}
              >
                {ENTRY_ICON[entry.kind]}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                  <span
                    className="block h-full rounded-full bg-foreground/60"
                    style={{
                      width: `${largest > 0 ? ((entry.bytes ?? 0) / largest) * 100 : 0}%`
                    }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums">
                  <EntrySize entry={entry} />
                </span>
              </button>
              <MachineDiskRowAction
                label={t('auto.components.machines.disk.delete', 'Delete…')}
                onClick={() => setDeleting([entry.path])}
              >
                <Trash2 />
              </MachineDiskRowAction>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 ? (
        <p className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
          {notes.join(' ')}
        </p>
      ) : null}
      <MachineDeleteDialog
        paths={deleting}
        machineLabel={machine.label}
        onConfirm={async (paths) => {
          await machineResourceApi().remove({ machineId, paths })
          setReload((count) => count + 1)
          onDeleted()
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
