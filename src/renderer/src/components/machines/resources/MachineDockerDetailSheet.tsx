import React, { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle
} from '@/components/ui/sheet'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineDockerDetails,
  MachineDockerDetailTarget
} from '../../../../../shared/machines/machine-docker-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { AGENT_CONFIG_SHEET_BELOW_WINDOW_CONTROLS } from '../../agent-config/agent-config-sheet-placement'
import { MachineDockerContainerDetail } from './MachineDockerContainerDetail'
import { MachineDockerImageDetail } from './MachineDockerImageDetail'
import { MachineDockerVolumeDetail } from './MachineDockerVolumeDetail'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

function targetKey(target: MachineDockerDetailTarget): string {
  return `${target.kind}\n${target.id}`
}

/** A container id, an image id, or the name Docker gives an anonymous volume. */
function isDockerHash(name: string): boolean {
  return /^(sha256:)?[0-9a-f]{64}$/.test(name)
}

/** What the sheet is titled with: the object's name once known, else what it was asked for by. */
function titleOf(target: MachineDockerDetailTarget, details: MachineDockerDetails | null): string {
  switch (details?.kind) {
    case 'container':
    case 'volume':
      return details.name
    case 'image':
      return details.tags[0] ?? details.id
    case undefined:
      return target.id
  }
}

type Loaded = { details: MachineDockerDetails | null; error: string | null }

function DockerDetail({
  machine,
  target,
  onBack,
  onFollow,
  onLeave,
  onClose,
  onChanged
}: {
  machine: MachineSummary
  target: MachineDockerDetailTarget
  /** Present when this object was reached from another one in the sheet. */
  onBack: (() => void) | null
  onFollow: (target: MachineDockerDetailTarget) => void
  /** The object is gone: back to where it was opened from, or out of the sheet. */
  onLeave: () => void
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const machineId = machine.id
  const { kind, id } = target

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      let next: Loaded
      try {
        next = {
          details: await machineResourceApi().dockerDetails({ machineId, target: { kind, id } }),
          error: null
        }
      } catch (err) {
        next = { details: null, error: resourceErrorText(err) }
      }
      if (!cancelled) {
        setLoaded(next)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [machineId, kind, id, revision])

  const reload = useCallback(() => setRevision((count) => count + 1), [])
  const details = loaded?.details ?? null
  const title = titleOf(target, details)
  const kindLabel =
    kind === 'container'
      ? t('auto.components.machines.dockerDetails.kind.container', 'Container')
      : kind === 'image'
        ? t('auto.components.machines.dockerDetails.kind.image', 'Image')
        : t('auto.components.machines.dockerDetails.kind.volume', 'Volume')

  return (
    <>
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        {onBack ? (
          <Button type="button" variant="ghost" size="xs" onClick={onBack} data-machine-docker-back>
            <ArrowLeft />
            {t('auto.components.machines.dockerDetails.back', 'Back')}
          </Button>
        ) : null}
        <div className="min-w-0 flex-1 px-1">
          <SheetDescription className="truncate text-2xs font-semibold tracking-wider uppercase">
            {t('auto.components.machines.dockerDetails.kindOn', '{{kind}} on {{machine}}', {
              kind: kindLabel,
              machine: machine.label
            })}
          </SheetDescription>
          <SheetTitle
            className={cn('truncate text-sm', isDockerHash(title) && 'font-mono')}
            title={title}
          >
            {isDockerHash(title) ? title.replace(/^sha256:/, '').slice(0, 12) : title}
          </SheetTitle>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('auto.components.machines.dockerDetails.refresh', 'Refresh')}
          disabled={loading}
          onClick={reload}
        >
          <RefreshCw className={cn(loading && loaded !== null && 'animate-spin')} />
        </Button>
        <SheetClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.machines.dockerDetails.close', 'Close')}
          >
            <X />
          </Button>
        </SheetClose>
      </header>
      <div className="scrollbar-sleek @container min-h-0 flex-1 overflow-y-auto p-4">
        {loaded === null ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : details === null ? (
          <div className="space-y-3" data-machine-docker-detail-error>
            <p className="text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
              {loaded.error}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t('auto.components.machines.dockerDetails.close', 'Close')}
            </Button>
          </div>
        ) : details.kind === 'container' ? (
          <MachineDockerContainerDetail
            machine={machine}
            details={details}
            revision={revision}
            onTarget={onFollow}
            onReload={reload}
            onChanged={onChanged}
            onRemoved={onLeave}
          />
        ) : details.kind === 'image' ? (
          <MachineDockerImageDetail details={details} onTarget={onFollow} />
        ) : (
          <MachineDockerVolumeDetail
            machine={machine}
            details={details}
            revision={revision}
            onTarget={onFollow}
          />
        )}
      </div>
    </>
  )
}

/** Where the sheet has been, so Back returns from a container to the image or volume it was opened from. */
type Trail = { stack: MachineDockerDetailTarget[]; at: string | null }

/**
 * One container, image or volume of a machine's Docker, in a panel over the page. The storage
 * manager and the resource views open the same sheet, and its links move between the three.
 */
export function MachineDockerDetailSheet({
  machine,
  target,
  onTarget,
  onChanged
}: {
  machine: MachineSummary
  /** Null closes the sheet. */
  target: MachineDockerDetailTarget | null
  /** Follows a link inside the sheet, or closes with null. */
  onTarget: (target: MachineDockerDetailTarget | null) => void
  /** Something on the machine changed; callers reload their lists. */
  onChanged: () => void
}): React.JSX.Element {
  const at = target ? targetKey(target) : null
  const [trail, setTrail] = useState<Trail>({ stack: [], at })
  // Opened on something else from outside, so there is nothing to go back to.
  if (trail.at !== at) {
    setTrail({ stack: [], at })
  }
  const stack = trail.at === at ? trail.stack : []
  // What was last open stays drawn while the sheet slides shut.
  const [shown, setShown] = useState(target)
  if (target && (!shown || targetKey(shown) !== at)) {
    setShown(target)
  }
  const drawn = target ?? shown

  const follow = (next: MachineDockerDetailTarget): void => {
    if (target) {
      setTrail({ stack: [...stack, target], at: targetKey(next) })
      onTarget(next)
    }
  }
  const previous = stack.at(-1)
  const back = previous
    ? (): void => {
        setTrail({ stack: stack.slice(0, -1), at: targetKey(previous) })
        onTarget(previous)
      }
    : null
  const close = (): void => onTarget(null)

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        showCloseButton={false}
        className="w-[92vw] sm:max-w-[640px]"
        style={AGENT_CONFIG_SHEET_BELOW_WINDOW_CONTROLS}
        data-machine-docker-detail={drawn?.kind}
      >
        {drawn ? (
          <DockerDetail
            key={targetKey(drawn)}
            machine={machine}
            target={drawn}
            onBack={back}
            onFollow={follow}
            onLeave={back ?? close}
            onClose={close}
            onChanged={onChanged}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
