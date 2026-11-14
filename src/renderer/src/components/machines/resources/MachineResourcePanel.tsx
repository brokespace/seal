import React from 'react'
import { X } from 'lucide-react'
import { PAGE_GUTTER_X } from '@/components/page-layout/PageLayout'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineMetrics } from '../../../../../shared/machines/machine-types'
import { MachineDiskDetail } from './MachineDiskDetail'
import { MachineCpuDetail, MachineMemoryDetail } from './MachineProcessDetails'
import type { MachineResourceKind } from './machine-resource-requests'

/** What a CPU, RAM or Disk meter opens: who is using that resource, and what can be done about it. */
export function MachineResourcePanel({
  machine,
  metrics,
  kind,
  onClose,
  onReveal
}: {
  machine: MachineSummary
  metrics: MachineMetrics | null
  kind: MachineResourceKind
  onClose: () => void
  onReveal: (folder: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const title =
    kind === 'cpu'
      ? t('auto.components.machines.resources.cpuTitle', 'CPU: busiest processes')
      : kind === 'memory'
        ? t('auto.components.machines.resources.memoryTitle', 'Memory: largest processes')
        : t('auto.components.machines.resources.diskTitle', 'Disk: usage and cleanup')
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label={title}
      data-machine-resource-panel={kind}
    >
      <header
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-border py-1.5',
          PAGE_GUTTER_X
        )}
      >
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onClose}
          data-machine-resource-close
        >
          <X />
          {t('auto.components.machines.resources.close', 'Back to files')}
        </Button>
      </header>
      <div
        className={cn(
          'scrollbar-sleek @container min-h-0 flex-1 overflow-y-auto py-3',
          PAGE_GUTTER_X
        )}
      >
        {metrics?.os === 'win32' ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'auto.components.machines.resources.unsupported',
              'Process, memory and disk details are available for Linux and macOS machines.'
            )}
          </p>
        ) : kind === 'cpu' ? (
          <MachineCpuDetail machine={machine} metrics={metrics} />
        ) : kind === 'memory' ? (
          <MachineMemoryDetail machine={machine} metrics={metrics} />
        ) : (
          <MachineDiskDetail machine={machine} metrics={metrics} onReveal={onReveal} />
        )}
      </div>
    </section>
  )
}
