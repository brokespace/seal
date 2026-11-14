import React from 'react'
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, CircleCheck, Globe, X } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/class-names'
import type { MachineTransfer } from '../../../../../shared/machines/machine-types'
import { formatBytes, transferPercent } from '../model/machine-format'

function DirectionIcon({ transfer }: { transfer: MachineTransfer }): React.JSX.Element {
  if (transfer.status === 'failed') {
    return <CircleAlert className="size-4 shrink-0 text-destructive" />
  }
  if (transfer.status === 'done') {
    return <CircleCheck className="size-4 shrink-0 text-status-success" />
  }
  if (transfer.direction === 'url-download') {
    return <Globe className="size-4 shrink-0 text-muted-foreground" />
  }
  return transfer.direction === 'upload' ? (
    <ArrowUpFromLine className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <ArrowDownToLine className="size-4 shrink-0 text-muted-foreground" />
  )
}

function TransferRow({ transfer }: { transfer: MachineTransfer }): React.JSX.Element {
  const t = useTranslate()
  const percent = transferPercent(transfer.transferredBytes, transfer.totalBytes)
  const running = transfer.status === 'running'
  const bytes =
    transfer.totalBytes === null
      ? formatBytes(transfer.transferredBytes)
      : `${formatBytes(transfer.transferredBytes)} / ${formatBytes(transfer.totalBytes)}`
  const files =
    transfer.filesTotal > 1
      ? t('auto.components.machines.transfers.files', '{{done}} of {{total}} files', {
          done: transfer.filesDone,
          total: transfer.filesTotal
        })
      : null
  const statusText =
    transfer.status === 'failed'
      ? (transfer.error ?? t('auto.components.machines.transfers.failed', 'Failed'))
      : transfer.status === 'cancelled'
        ? t('auto.components.machines.transfers.cancelled', 'Cancelled')
        : null
  return (
    <li className="flex items-center gap-2 px-3 py-1.5" data-machine-transfer={transfer.status}>
      <DirectionIcon transfer={transfer} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px]">{transfer.label}</span>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
            {bytes}
          </span>
        </div>
        {running ? <Progress value={percent ?? undefined} className="mt-1 h-1" /> : null}
        <div className="flex gap-2 text-2xs text-muted-foreground">
          {files ? <span>{files}</span> : null}
          <span className="min-w-0 truncate font-mono" title={transfer.destination}>
            {transfer.destination}
          </span>
        </div>
        {statusText ? (
          <p
            className={cn(
              'text-2xs [overflow-wrap:anywhere]',
              transfer.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {statusText}
          </p>
        ) : null}
      </div>
      {running ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('auto.components.machines.transfers.cancel', 'Cancel transfer')}
          onClick={() => void window.api.machines?.cancelTransfer({ transferId: transfer.id })}
        >
          <X />
        </Button>
      ) : null}
    </li>
  )
}

export function MachineTransfersPanel({
  transfers,
  onClearFinished
}: {
  transfers: readonly MachineTransfer[]
  onClearFinished: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  if (transfers.length === 0) {
    return null
  }
  const running = transfers.filter((transfer) => transfer.status === 'running').length
  const ordered = [...transfers].sort((a, b) => b.startedAt - a.startedAt)
  return (
    <section className="flex max-h-56 shrink-0 flex-col border-t border-border bg-card">
      <header className="flex items-center gap-2 px-3 py-1.5">
        <h3 className="flex-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {running > 0
            ? t('auto.components.machines.transfers.running', 'Transfers · {{count}} running', {
                count: running
              })
            : t('auto.components.machines.transfers.title', 'Transfers')}
        </h3>
        {transfers.length > running ? (
          <Button type="button" variant="ghost" size="xs" onClick={onClearFinished}>
            {t('auto.components.machines.transfers.clear', 'Clear finished')}
          </Button>
        ) : null}
      </header>
      <ul className="scrollbar-sleek min-h-0 overflow-y-auto pb-1">
        {ordered.map((transfer) => (
          <TransferRow key={transfer.id} transfer={transfer} />
        ))}
      </ul>
    </section>
  )
}
