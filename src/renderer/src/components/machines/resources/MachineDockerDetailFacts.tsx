import React from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { getIntlLocale } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { MachineDiskRowAction } from './MachineDiskRowAction'

/** The named facts of one Docker object, label beside value. */
export function MachineDockerFacts({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 text-xs">
      {children}
    </dl>
  )
}

export function MachineDockerFact({
  label,
  mono = false,
  children
}: {
  label: string
  /** Ids, paths and commands read as literals. */
  mono?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 [overflow-wrap:anywhere] select-text', mono && 'font-mono')}>
        {children}
      </dd>
    </div>
  )
}

/** How long ago something happened, with the date and time on hover. */
export function MachineDockerTime({ at }: { at: number | null }): React.JSX.Element {
  if (at === null || Number.isNaN(at)) {
    return <>—</>
  }
  const date = new Date(at)
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString(getIntlLocale())}>
      {formatUiRelativeTimeFromDate(date.toISOString())}
    </time>
  )
}

/** Opens another Docker object in the details sheet. */
export function MachineDockerLink({
  mono = false,
  className,
  onOpen,
  children
}: {
  mono?: boolean
  className?: string
  onOpen: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'max-w-full rounded-sm text-left underline decoration-border underline-offset-2 outline-none [overflow-wrap:anywhere] hover:decoration-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        mono && 'font-mono',
        className
      )}
      onClick={onOpen}
    >
      {children}
    </button>
  )
}

export async function copyDockerText(text: string, copied: string, failed: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(text)
    toast.success(copied)
  } catch {
    toast.error(failed)
  }
}

export function MachineDockerCopyButton({
  text,
  label
}: {
  text: string
  /** Names what is copied, e.g. "Copy the mountpoint". */
  label: string
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <span className="-my-1 ml-1 inline-flex align-middle text-muted-foreground">
      <MachineDiskRowAction
        label={label}
        onClick={() =>
          void copyDockerText(
            text,
            t('auto.components.machines.dockerDetails.copied', 'Copied'),
            t('auto.components.machines.dockerDetails.copyFailed', 'Could not copy')
          )
        }
      >
        <Copy />
      </MachineDiskRowAction>
    </span>
  )
}
