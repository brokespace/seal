import React from 'react'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineDockerContainerRef,
  MachineDockerDetailTarget
} from '../../../../../shared/machines/machine-docker-types'
import { MachineDockerLink } from './MachineDockerDetailFacts'

function useStateLabel(state: string, exitCode: number | null | undefined): string {
  const t = useTranslate()
  switch (state) {
    case 'running':
      return t('auto.components.machines.dockerDetails.state.running', 'Running')
    case 'exited':
      return exitCode === null || exitCode === undefined
        ? t('auto.components.machines.dockerDetails.state.exited', 'Exited')
        : t('auto.components.machines.dockerDetails.state.exitedWith', 'Exited ({{code}})', {
            code: exitCode
          })
    case 'paused':
      return t('auto.components.machines.dockerDetails.state.paused', 'Paused')
    case 'restarting':
      return t('auto.components.machines.dockerDetails.state.restarting', 'Restarting')
    case 'dead':
      return t('auto.components.machines.dockerDetails.state.dead', 'Dead')
    case 'created':
      return t('auto.components.machines.dockerDetails.state.created', 'Created')
    default:
      return state
  }
}

/** A container's state in Docker's own words; only a failure takes color. */
export function MachineDockerStateBadge({
  state,
  exitCode,
  dense = false
}: {
  state: string
  /** Shown beside `exited`, and a non-zero one reads as a failure. */
  exitCode?: number | null
  /** For a row in a list rather than the headline of the sheet. */
  dense?: boolean
}): React.JSX.Element {
  const label = useStateLabel(state, exitCode)
  const failed = state === 'dead' || (state === 'exited' && Boolean(exitCode))
  return (
    <Badge
      variant={dense ? 'referenceLabel' : state === 'running' ? 'secondary' : 'outline'}
      className={cn(
        dense && state === 'running' && 'text-foreground',
        failed && 'border-destructive/40 text-destructive'
      )}
      data-machine-docker-state={state}
    >
      {label}
    </Badge>
  )
}

/** The containers that use an image or a volume; each opens that container's details. */
export function MachineDockerContainerRefs<T extends MachineDockerContainerRef>({
  containers,
  empty,
  detail,
  onTarget
}: {
  containers: readonly T[]
  /** Said when nothing uses it. */
  empty: string
  /** What else to say about one container, e.g. where it mounts the volume. */
  detail?: (container: T) => React.ReactNode
  onTarget: (target: MachineDockerDetailTarget) => void
}): React.JSX.Element {
  if (containers.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>
  }
  return (
    <ul className="divide-y divide-border/60 rounded-md border border-border text-xs">
      {containers.map((container) => (
        <li
          key={container.id}
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5"
          data-machine-docker-used-by={container.id}
        >
          <MachineDockerLink
            className="min-w-0 truncate font-medium"
            onOpen={() => onTarget({ kind: 'container', id: container.id })}
          >
            {container.name}
          </MachineDockerLink>
          <MachineDockerStateBadge state={container.state} dense />
          {detail ? (
            <span className="ml-auto flex min-w-0 items-center gap-1.5 text-muted-foreground">
              {detail(container)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
