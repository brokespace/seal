import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineMetrics, MachineOs } from '../../../../../shared/machines/machine-types'
import { cpuLoadPercent, formatBytes, formatUptime, usedPercent } from '../model/machine-format'
import type { MachineStatus } from '../../../../../shared/machines/machine-summaries'
import type { MachineResourceKind } from '../resources/machine-resource-requests'

function statusDotClass(status: MachineStatus): string {
  switch (status) {
    case 'online':
      return 'bg-status-success'
    case 'connecting':
      return 'bg-status-warning animate-pulse'
    case 'offline':
      return 'bg-muted-foreground/40'
    case 'error':
      return 'bg-destructive'
  }
}

export function MachineStatusDot({
  status,
  className
}: {
  status: MachineStatus
  className?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', statusDotClass(status), className)}
    />
  )
}

export function useMachineStatusLabel(): (status: MachineStatus) => string {
  const t = useTranslate()
  return (status) => {
    switch (status) {
      case 'online':
        return t('auto.components.machines.status.online', 'Online')
      case 'connecting':
        return t('auto.components.machines.status.connecting', 'Connecting')
      case 'error':
        return t('auto.components.machines.status.error', 'Connection failed')
      case 'offline':
        return t('auto.components.machines.status.offline', 'Offline')
    }
  }
}

export function machineOsLabel(os: MachineOs | null): string | null {
  switch (os) {
    case 'linux':
      return 'Linux'
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case null:
      return null
  }
}

/** Compact used-share bar; amber past 75% and red past 90% so pressure stands out in a list. */
export function MachineMeter({
  label,
  percent,
  detail,
  compact = false
}: {
  label: string
  percent: number | null
  detail?: string
  compact?: boolean
}): React.JSX.Element {
  const tone =
    percent === null
      ? 'bg-muted-foreground/30'
      : percent >= 90
        ? 'bg-destructive'
        : percent >= 75
          ? 'bg-status-warning'
          : 'bg-foreground/60'
  return (
    <div className={cn('min-w-0', compact ? 'flex items-center gap-1.5' : 'space-y-1')}>
      <div
        className={cn(
          'flex items-baseline gap-1 text-muted-foreground',
          compact ? 'w-9 shrink-0 text-3xs' : 'justify-between text-2xs'
        )}
      >
        <span className="font-medium tracking-wide uppercase">{label}</span>
        {compact ? null : (
          <span className="truncate font-mono tabular-nums">
            {detail ?? (percent === null ? '—' : `${Math.round(percent)}%`)}
          </span>
        )}
      </div>
      <div
        className={cn('overflow-hidden rounded-full bg-muted', compact ? 'h-1 flex-1' : 'h-1.5')}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.round(percent)}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', tone)}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  )
}

export function machineMeterValues(metrics: MachineMetrics | null): {
  cpu: number | null
  memory: number | null
  disk: number | null
} {
  return {
    cpu: metrics
      ? cpuLoadPercent(metrics.loadAverage, metrics.cpuCount, metrics.cpuUsagePercent)
      : null,
    memory: metrics ? usedPercent(metrics.memTotalBytes, metrics.memAvailableBytes) : null,
    disk: metrics ? usedPercent(metrics.diskTotalBytes, metrics.diskAvailableBytes) : null
  }
}

function MeterButton({
  kind,
  label,
  selected,
  onSelect,
  children
}: {
  kind: MachineResourceKind
  label: string
  selected: boolean
  onSelect: ((kind: MachineResourceKind) => void) | undefined
  children: React.ReactNode
}): React.JSX.Element {
  if (!onSelect) {
    return <>{children}</>
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      data-machine-meter={kind}
      className={cn(
        '-m-1.5 min-w-0 rounded-md border border-transparent p-1.5 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:border-ring focus-visible:outline-none',
        selected && 'border-border bg-accent/60'
      )}
      onClick={() => onSelect(kind)}
    >
      {children}
    </button>
  )
}

export function MachineVitalsStrip({
  metrics,
  error,
  selected = null,
  onSelect
}: {
  metrics: MachineMetrics | null
  error: string | null
  selected?: MachineResourceKind | null
  /** Makes each meter a button that opens what is using that resource. */
  onSelect?: (kind: MachineResourceKind) => void
}): React.JSX.Element {
  const t = useTranslate()
  const values = machineMeterValues(metrics)
  const used = (total: number | null, available: number | null): string =>
    total === null || available === null
      ? '—'
      : `${formatBytes(total - available)} / ${formatBytes(total)}`
  const facts = [
    metrics?.hostname,
    [machineOsLabel(metrics?.os ?? null), metrics?.osRelease].filter(Boolean).join(' '),
    metrics?.arch,
    metrics?.cpuCount
      ? t('auto.components.machines.vitals.cores', '{{count}} cores', { count: metrics.cpuCount })
      : null,
    metrics?.uptimeSeconds !== null && metrics?.uptimeSeconds !== undefined
      ? t('auto.components.machines.vitals.uptime', 'up {{uptime}}', {
          uptime: formatUptime(metrics.uptimeSeconds)
        })
      : null
  ].filter((fact): fact is string => Boolean(fact))
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-4">
        <MeterButton
          kind="cpu"
          label={t('auto.components.machines.vitals.cpuDetails', 'CPU: show the busiest processes')}
          selected={selected === 'cpu'}
          onSelect={onSelect}
        >
          <MachineMeter
            label={t('auto.components.machines.vitals.cpu', 'CPU')}
            percent={values.cpu}
            detail={
              metrics?.loadAverage
                ? t('auto.components.machines.vitals.load', 'load {{load}}', {
                    load: metrics.loadAverage[0].toFixed(2)
                  })
                : undefined
            }
          />
        </MeterButton>
        <MeterButton
          kind="memory"
          label={t(
            'auto.components.machines.vitals.memoryDetails',
            'RAM: show what is using memory'
          )}
          selected={selected === 'memory'}
          onSelect={onSelect}
        >
          <MachineMeter
            label={t('auto.components.machines.vitals.memory', 'RAM')}
            percent={values.memory}
            detail={used(metrics?.memTotalBytes ?? null, metrics?.memAvailableBytes ?? null)}
          />
        </MeterButton>
        <MeterButton
          kind="disk"
          label={t(
            'auto.components.machines.vitals.diskDetails',
            'Disk: show what is taking space'
          )}
          selected={selected === 'disk'}
          onSelect={onSelect}
        >
          <MachineMeter
            label={t('auto.components.machines.vitals.disk', 'Disk')}
            percent={values.disk}
            detail={used(metrics?.diskTotalBytes ?? null, metrics?.diskAvailableBytes ?? null)}
          />
        </MeterButton>
      </div>
      {facts.length > 0 || error ? (
        <p
          className="truncate text-2xs text-muted-foreground"
          title={error ?? metrics?.cpuModel ?? undefined}
        >
          {error ? <span className="text-destructive">{error}</span> : facts.join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
