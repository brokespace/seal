import React, { useCallback, useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/class-names'
import type { MachineDiskMount } from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineMetrics } from '../../../../../shared/machines/machine-types'
import { formatBytes } from '../model/machine-format'
import { refreshMachineMetrics } from '../model/machine-metrics-store'
import { MachineCleanupSection } from './MachineCleanupSection'
import { MachineDiskUsageBrowser } from './MachineDiskUsageBrowser'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

function MountRow({
  mount,
  active,
  onOpen
}: {
  mount: MachineDiskMount
  active: boolean
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const percent = mount.totalBytes > 0 ? (mount.usedBytes / mount.totalBytes) * 100 : 0
  const tone =
    percent >= 90 ? 'bg-destructive' : percent >= 75 ? 'bg-status-warning' : 'bg-foreground/60'
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        className={cn(
          'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/40',
          active && 'bg-accent/60'
        )}
        onClick={onOpen}
      >
        <span className="min-w-0 truncate">
          <span className="font-mono font-medium">{mount.mount}</span>
          <span className="ml-2 text-2xs text-muted-foreground">{mount.filesystem}</span>
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
      </button>
    </li>
  )
}

export function MachineDiskDetail({
  machine,
  metrics,
  onReveal
}: {
  machine: MachineSummary
  metrics: MachineMetrics | null
  onReveal: (folder: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const machineId = machine.id
  const [mounts, setMounts] = useState<MachineDiskMount[] | null>(null)
  const [mountsError, setMountsError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [tab, setTab] = useState('usage')
  // The drill-down starts where the user's own files are, not at a root that takes minutes to size.
  const path = picked ?? metrics?.homeDir ?? null

  const loadMounts = useCallback(async (): Promise<void> => {
    try {
      setMounts(await machineResourceApi().listDiskMounts({ machineId }))
      setMountsError(null)
    } catch (err) {
      setMountsError(resourceErrorText(err))
    }
  }, [machineId])

  useEffect(() => {
    void loadMounts()
  }, [loadMounts])

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <h3 className="text-3xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('auto.components.machines.disk.mounts', 'Disks')}
        </h3>
        {mountsError ? (
          <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {mountsError}
          </p>
        ) : null}
        <ul className="space-y-0.5" data-machine-disk-mounts={mounts ? 'ready' : 'loading'}>
          {(mounts ?? []).map((mount) => (
            <MountRow
              key={`${mount.filesystem}:${mount.mount}`}
              mount={mount}
              active={tab === 'usage' && path === mount.mount}
              onOpen={() => {
                setPicked(mount.mount)
                setTab('usage')
              }}
            />
          ))}
        </ul>
      </section>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList size="sm">
          <TabsTrigger value="usage">
            {t('auto.components.machines.disk.usageTab', "What's taking space")}
          </TabsTrigger>
          <TabsTrigger value="cleanup">
            {t('auto.components.machines.disk.cleanupTab', 'Clean up')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="usage">
          {path ? (
            <MachineDiskUsageBrowser
              machine={machine}
              path={path}
              onPath={setPicked}
              onReveal={onReveal}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="cleanup">
          <MachineCleanupSection
            machine={machine}
            onCleaned={() => {
              void loadMounts()
              void refreshMachineMetrics(machineId)
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
