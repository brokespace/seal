import React, { useEffect, useState } from 'react'
import { ArrowUp, File, Folder, FolderOpen, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineDiskUsage,
  MachineDiskUsageEntry
} from '../../../../../shared/machines/machine-resource-types'
import { machinePathDirname } from '../../../../../shared/machines/machine-paths'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { MachineDeleteDialog } from '../explorer/MachineDeleteDialog'
import { MachinePathCrumbs } from '../explorer/MachinePathCrumbs'
import { formatBytes } from '../model/machine-format'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

const ENTRY_ICON: Record<MachineDiskUsageEntry['kind'], React.JSX.Element> = {
  directory: <Folder className="size-3.5 shrink-0 text-muted-foreground" />,
  file: <File className="size-3.5 shrink-0 text-muted-foreground" />,
  symlink: <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
}

function RowAction({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** What is taking space under a folder, largest first; folders open to show what is inside them. */
export function MachineDiskUsageBrowser({
  machine,
  path,
  onPath,
  onReveal
}: {
  machine: MachineSummary
  path: string
  onPath: (path: string) => void
  onReveal: (folder: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const machineId = machine.id
  const [sized, setSized] = useState<ReadonlyMap<string, MachineDiskUsage>>(new Map())
  const [error, setError] = useState<{ path: string; message: string } | null>(null)
  const [rescan, setRescan] = useState(0)
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const usage = sized.get(path) ?? null
  const needsScan = usage === null

  useEffect(() => {
    if (!needsScan) {
      return
    }
    let cancelled = false
    void machineResourceApi()
      .measureDiskUsage({ machineId, path })
      .then((result) => {
        if (!cancelled) {
          setSized((previous) => new Map(previous).set(path, result))
          setError(null)
        }
      })
      .catch((err: unknown) => {
        // Opening another folder cancels this scan on the machine; that is not a failure to show.
        if (!cancelled) {
          setError({ path, message: resourceErrorText(err) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [machineId, path, needsScan, rescan])

  const forget = (target: string): void => {
    setError(null)
    setSized((previous) => {
      const next = new Map(previous)
      next.delete(target)
      return next
    })
    setRescan((count) => count + 1)
  }
  const parent = machinePathDirname(path)
  const largest = usage?.entries[0]?.bytes ?? 0
  const failed = error?.path === path ? error.message : null

  return (
    <div data-machine-disk-usage={path}>
      <div className="flex items-center gap-0.5 border-b border-border pb-1">
        <RowAction
          label={t('auto.components.machines.disk.up', 'Parent folder')}
          onClick={() => parent && onPath(parent)}
        >
          <ArrowUp />
        </RowAction>
        <MachinePathCrumbs
          path={path}
          label={t('auto.components.machines.disk.path', 'Folder being sized')}
          onOpen={onPath}
        />
        <span className="shrink-0 px-2 font-mono text-xs tabular-nums">
          {usage ? formatBytes(usage.totalBytes) : ''}
        </span>
        <RowAction
          label={t('auto.components.machines.disk.rescan', 'Measure again')}
          onClick={() => forget(path)}
        >
          <RefreshCw />
        </RowAction>
        <RowAction
          label={t('auto.components.machines.disk.reveal', 'Show in files')}
          onClick={() => onReveal(path)}
        >
          <FolderOpen />
        </RowAction>
      </div>
      {failed ? (
        <p className="py-3 text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {failed}
        </p>
      ) : usage === null ? (
        <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t(
            'auto.components.machines.disk.sizing',
            'Measuring… large folders take a while the first time.'
          )}
        </div>
      ) : usage.entries.length === 0 ? (
        <p className="py-6 text-xs text-muted-foreground">
          {t('auto.components.machines.disk.empty', 'This folder is empty.')}
        </p>
      ) : (
        <ul>
          {usage.entries.map((entry) => (
            <li
              key={entry.path}
              className="group flex items-center gap-2 border-b border-border/60 text-xs hover:bg-accent/40"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left disabled:cursor-default"
                disabled={entry.kind !== 'directory'}
                onClick={() => onPath(entry.path)}
              >
                {ENTRY_ICON[entry.kind]}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                  <span
                    className="block h-full rounded-full bg-foreground/60"
                    style={{ width: `${largest > 0 ? (entry.bytes / largest) * 100 : 0}%` }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right font-mono tabular-nums">
                  {formatBytes(entry.bytes)}
                </span>
              </button>
              <RowAction
                label={t('auto.components.machines.disk.delete', 'Delete…')}
                onClick={() => setDeleting([entry.path])}
              >
                <Trash2 />
              </RowAction>
            </li>
          ))}
        </ul>
      )}
      {usage && (usage.omittedCount > 0 || usage.incomplete) ? (
        <p className="pt-2 text-2xs text-muted-foreground">
          {[
            usage.omittedCount > 0
              ? t(
                  'auto.components.machines.disk.omitted',
                  '{{count}} smaller items ({{size}}) are not listed.',
                  {
                    count: usage.omittedCount,
                    size: formatBytes(usage.omittedBytes),
                    defaultValue_one: '{{count}} smaller item ({{size}}) is not listed.'
                  }
                )
              : null,
            usage.incomplete
              ? t(
                  'auto.components.machines.disk.incomplete',
                  'Some folders could not be read, so the real total is larger.'
                )
              : null
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      ) : null}
      <MachineDeleteDialog
        paths={deleting}
        machineLabel={machine.label}
        onConfirm={async (paths) => {
          await machineResourceApi().remove({ machineId, paths })
          // Every folder above the deleted item is smaller now.
          setSized(new Map())
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
