import React, { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import {
  MACHINE_DOCKER_PRUNE_TARGETS,
  type MachineCleanupScan
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import {
  MachineDockerCleanUpCategory,
  type MachineDockerCleanUpOutcome,
  type MachineDockerCleanUpScan
} from './MachineDockerCleanUpCategory'
import {
  MachineCleanupFailureList,
  MachineCleanupProgressLine,
  useMachineCleanupProgress
} from './MachineDockerCleanUpProgress'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'
import { useMachineCleanupCopy } from './use-machine-cleanup-copy'

type Category = (typeof MACHINE_DOCKER_PRUNE_TARGETS)[number]

function readScan(scan: MachineCleanupScan): MachineDockerCleanUpScan {
  if (scan.unavailable) {
    return { status: 'failed', message: scan.unavailable }
  }
  const items = scan.items.filter((item) => !item.blocked && (item.inUseBy?.length ?? 0) === 0)
  return {
    status: 'ready',
    scan,
    items,
    bytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0)
  }
}

function CleanUpBody({
  machine,
  onClose,
  onCleaned
}: {
  machine: MachineSummary
  onClose: () => void
  onCleaned: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const copy = useMachineCleanupCopy()
  const machineId = machine.id
  const [scans, setScans] = useState<Partial<Record<Category, MachineDockerCleanUpScan>>>({})
  // Volumes hold data, so they are the one category the user has to tick.
  const [choices, setChoices] = useState<Record<Category, boolean>>({
    'docker-containers': true,
    'docker-dangling-images': true,
    'docker-build-cache': true,
    'docker-volumes': false
  })
  const [phase, setPhase] = useState<'review' | 'running' | 'done'>('review')
  const [active, setActive] = useState<Category | null>(null)
  const [outcomes, setOutcomes] = useState<Partial<Record<Category, MachineDockerCleanUpOutcome>>>(
    {}
  )
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const settle = (target: Category, next: MachineDockerCleanUpScan): void => {
      if (!cancelled) {
        setScans((previous) => ({ ...previous, [target]: next }))
      }
    }
    for (const target of MACHINE_DOCKER_PRUNE_TARGETS) {
      void machineResourceApi()
        .scanCleanup({ machineId, target })
        .then(
          (scan) => settle(target, readScan(scan)),
          (err: unknown) => settle(target, { status: 'failed', message: resourceErrorText(err) })
        )
    }
    return () => {
      cancelled = true
    }
  }, [machineId])

  const queue = MACHINE_DOCKER_PRUNE_TARGETS.flatMap((target) => {
    const state = scans[target]
    return state?.status === 'ready' && state.items.length > 0 && choices[target]
      ? [{ target, scan: state.scan, items: state.items, bytes: state.bytes }]
      : []
  })
  const scanning = MACHINE_DOCKER_PRUNE_TARGETS.some(
    (target) => (scans[target]?.status ?? 'scanning') === 'scanning'
  )
  const totalBytes = queue.reduce((sum, entry) => sum + entry.bytes, 0)
  const activeScan = active ? scans[active] : undefined
  const progress = useMachineCleanupProgress(
    activeScan?.status === 'ready' ? activeScan.scan.token : null
  )
  const finished = Object.values(outcomes)
  const freedBytes = finished.reduce((sum, outcome) => sum + outcome.freedBytes, 0)
  const failures = MACHINE_DOCKER_PRUNE_TARGETS.flatMap((target) =>
    (outcomes[target]?.failures ?? []).map((failure) => ({
      ...failure,
      id: `${target}:${failure.id}`
    }))
  )

  const run = async (): Promise<void> => {
    if (phase !== 'review' || queue.length === 0) {
      return
    }
    setPhase('running')
    let freed = 0
    let failed = 0
    for (const entry of queue) {
      setActive(entry.target)
      let outcome: MachineDockerCleanUpOutcome
      try {
        const result = await machineResourceApi().runCleanup({
          machineId,
          token: entry.scan.token,
          itemIds: entry.items.map((item) => item.id)
        })
        outcome = { freedBytes: result.freedBytes, failures: result.failures, error: null }
      } catch (err) {
        outcome = { freedBytes: 0, failures: [], error: resourceErrorText(err) }
      }
      freed += outcome.freedBytes
      failed += outcome.failures.length + (outcome.error ? 1 : 0)
      setOutcomes((previous) => ({ ...previous, [entry.target]: outcome }))
    }
    setActive(null)
    setPhase('done')
    onCleaned()
    // Closed while it ran: the outcome has nowhere to show but a toast.
    if (!mounted.current) {
      const message = t(
        'auto.components.machines.cleanup.freed',
        'Freed {{size}} on {{machine}}.',
        {
          size: formatBytes(freed),
          machine: machine.label
        }
      )
      if (failed > 0) {
        toast.error(
          `${message} ${t(
            'auto.components.machines.dockerCleanUp.someFailed',
            '{{count}} removals failed.',
            { count: failed, defaultValue_one: '{{count}} removal failed.' }
          )}`
        )
      } else {
        toast.success(message)
      }
    }
  }

  return (
    <>
      <ul
        className="divide-y divide-border/60 border-y border-border"
        data-machine-docker-clean-up-phase={phase}
      >
        {MACHINE_DOCKER_PRUNE_TARGETS.map((target) => (
          <MachineDockerCleanUpCategory
            key={target}
            target={target}
            copy={copy[target]}
            state={scans[target] ?? { status: 'scanning' }}
            outcome={outcomes[target] ?? null}
            running={active === target}
            ticked={choices[target]}
            editable={phase === 'review'}
            onTick={(ticked) => setChoices((previous) => ({ ...previous, [target]: ticked }))}
          />
        ))}
      </ul>
      {phase === 'running' ? (
        <MachineCleanupProgressLine progress={progress} />
      ) : phase === 'done' ? (
        <div className="space-y-2 text-xs" role="status" data-machine-docker-clean-up-result>
          <p className="font-medium">
            {t('auto.components.machines.cleanup.freed', 'Freed {{size}} on {{machine}}.', {
              size: formatBytes(freedBytes),
              machine: machine.label
            })}
          </p>
          {failures.length > 0 ? (
            <>
              <p>
                {t(
                  'auto.components.machines.dockerCleanUp.notRemoved',
                  '{{count}} items could not be removed:',
                  {
                    count: failures.length,
                    defaultValue_one: '{{count}} item could not be removed:'
                  }
                )}
              </p>
              <MachineCleanupFailureList failures={failures} />
            </>
          ) : null}
        </div>
      ) : (
        <div
          className="flex items-baseline justify-between gap-2 text-xs"
          data-machine-docker-clean-up-total
        >
          <span className="text-muted-foreground">
            {t('auto.components.machines.dockerCleanUp.total', 'Ticked categories free')}
          </span>
          <span className="font-mono text-sm tabular-nums">{formatBytes(totalBytes)}</span>
        </div>
      )}
      <DialogFooter>
        {phase === 'running' ? (
          <p className="mr-auto self-center text-2xs text-muted-foreground">
            {t(
              'auto.components.machines.cleanup.keepsRunning',
              'Closing this does not stop the removal.'
            )}
          </p>
        ) : null}
        <Button type="button" variant="outline" onClick={onClose}>
          {phase === 'review'
            ? t('auto.components.machines.cleanup.cancel', 'Cancel')
            : t('auto.components.machines.cleanup.close', 'Close')}
        </Button>
        {phase === 'done' ? null : (
          <Button
            type="button"
            variant="destructive"
            disabled={phase === 'running' || scanning || queue.length === 0}
            onClick={() => void run()}
            data-machine-docker-clean-up-confirm
          >
            {phase === 'running' || scanning ? <Loader2 className="animate-spin" /> : null}
            {t('auto.components.machines.dockerCleanUp.confirm', 'Clean up ({{size}})', {
              size: formatBytes(totalBytes)
            })}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

/**
 * One click to free what nothing uses, like `docker system prune`. Each category is read first,
 * and nothing is removed before the confirm button is pressed.
 */
export function MachineDockerCleanUpDialog({
  machine,
  open,
  onClose,
  onCleaned
}: {
  machine: MachineSummary
  open: boolean
  onClose: () => void
  onCleaned: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl" data-machine-docker-clean-up-dialog>
        <DialogHeader>
          <DialogTitle>
            {t(
              'auto.components.machines.dockerCleanUp.title',
              'Clean up unused Docker data on {{machine}}?',
              { machine: machine.label }
            )}
          </DialogTitle>
          <DialogDescription>
            {`${t(
              'auto.components.machines.dockerCleanUp.description',
              'Removes stopped containers, dangling images and build cache that nothing uses. Tagged images and networks are left alone.'
            )} ${t('auto.components.machines.cleanup.permanent', 'This cannot be undone.')}`}
          </DialogDescription>
        </DialogHeader>
        <CleanUpBody machine={machine} onClose={onClose} onCleaned={onCleaned} />
      </DialogContent>
    </Dialog>
  )
}
