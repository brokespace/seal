import React, { useEffect, useState } from 'react'
import { File, Folder, Loader2, Trash2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineDiskIndexLargest } from '../../../../../shared/machines/machine-disk-index-types'
import {
  machinePathBasename,
  machinePathDirname
} from '../../../../../shared/machines/machine-paths'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { MachineDeleteDialog } from '../explorer/MachineDeleteDialog'
import { formatBytes, formatCount, formatUptime } from '../model/machine-format'
import { MachineDiskRowAction } from './MachineDiskRowAction'
import {
  machineResourceApi,
  requestDiskIndexLargest,
  resourceErrorText
} from './machine-resource-requests'

/** The biggest files, or the folders holding the most directly, on one disk of a machine. */
export function MachineDiskLargestList({
  machine,
  mount,
  kind,
  indexed,
  generation,
  now,
  onOpenFolder,
  onDeleted
}: {
  machine: MachineSummary
  mount: string
  kind: MachineDiskIndexLargest['kind']
  /** False while the disk has no index to answer from. */
  indexed: boolean
  generation: number
  now: number
  onOpenFolder: (folder: string) => void
  onDeleted: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const machineId = machine.id
  const [largest, setLargest] = useState<(MachineDiskIndexLargest & { mount: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [deleting, setDeleting] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void requestDiskIndexLargest(machineId, mount, kind)
      .then((result) => {
        if (!cancelled) {
          setLargest({ ...result, mount })
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(resourceErrorText(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [machineId, mount, kind, generation, reload])

  const shown = largest?.mount === mount && largest.kind === kind ? largest : null
  const top = shown?.items[0]?.bytes ?? 0
  const Icon = kind === 'files' ? File : Folder

  return (
    <div data-machine-disk-largest={shown ? kind : 'loading'}>
      <p className="border-b border-border px-3 py-2 text-2xs text-muted-foreground">
        {kind === 'files'
          ? t(
              'auto.components.machines.disk.largest.filesIntro',
              'The largest files on {{mount}}.',
              {
                mount
              }
            )
          : t(
              'auto.components.machines.disk.largest.foldersIntro',
              'Folders on {{mount}} by the size of the files directly inside them, not counting subfolders.',
              { mount }
            )}
        {shown?.scannedAt != null
          ? ` ${t('auto.components.machines.disk.largest.age', 'As of {{age}} ago.', {
              age: formatUptime(Math.max(0, (now - shown.scannedAt) / 1000))
            })}`
          : ''}
      </p>
      {error ? (
        <p className="px-3 py-3 text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {error}
        </p>
      ) : !indexed ? (
        <p className="px-3 py-6 text-xs text-muted-foreground">
          {t(
            'auto.components.machines.disk.largest.noIndex',
            'This list comes from the background index, which this disk does not have yet.'
          )}
        </p>
      ) : shown === null ? (
        <div className="flex h-16 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : shown.items.length === 0 ? (
        <p className="px-3 py-6 text-xs text-muted-foreground">
          {t('auto.components.machines.disk.largest.none', 'Nothing has been indexed here yet.')}
        </p>
      ) : (
        <ul>
          {shown.items.map((item) => {
            const folder = kind === 'files' ? machinePathDirname(item.path) : item.path
            return (
              <li
                key={item.path}
                className="flex items-center gap-2 border-b border-border/60 pr-1.5 text-xs last:border-b-0 hover:bg-accent/40"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                  title={item.path}
                  onClick={() => folder && onOpenFolder(folder)}
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{machinePathBasename(item.path)}</span>
                    <span className="block truncate font-mono text-2xs text-muted-foreground">
                      {kind === 'files'
                        ? machinePathDirname(item.path)
                        : `${machinePathDirname(item.path) ?? ''} · ${t(
                            'auto.components.machines.disk.largest.direct',
                            '{{formatted}} files',
                            { formatted: formatCount(item.files ?? 0) }
                          )}`}
                    </span>
                  </span>
                  <span className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                    <span
                      className="block h-full rounded-full bg-foreground/60"
                      style={{ width: `${top > 0 ? (item.bytes / top) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono tabular-nums">
                    {formatBytes(item.bytes)}
                  </span>
                </button>
                <MachineDiskRowAction
                  label={t('auto.components.machines.disk.delete', 'Delete…')}
                  onClick={() => setDeleting([item.path])}
                >
                  <Trash2 />
                </MachineDiskRowAction>
              </li>
            )
          })}
        </ul>
      )}
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
