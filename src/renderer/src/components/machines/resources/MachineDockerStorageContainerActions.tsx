import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineDockerStoredContainer } from '../../../../../shared/machines/machine-docker-types'
import type { MachineDockerConfirmedAction } from './MachineDockerContainerDialog'

/** What a container's row offers: a running one stops, a stopped one starts or goes. */
export function MachineDockerStorageContainerActions({
  container,
  starting,
  onStart,
  onAsk
}: {
  container: MachineDockerStoredContainer
  starting: boolean
  onStart: () => void
  /** Stopping and removing are confirmed first. */
  onAsk: (action: MachineDockerConfirmedAction) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      className="flex shrink-0 gap-1"
      // The row itself opens the details.
      onClick={(event) => event.stopPropagation()}
      data-machine-docker-row-actions
    >
      {container.running ? (
        <Button type="button" variant="outline" size="xs" onClick={() => onAsk('stop')}>
          {t('auto.components.machines.docker.stop', 'Stop')}
        </Button>
      ) : (
        <>
          <Button type="button" variant="outline" size="xs" disabled={starting} onClick={onStart}>
            {starting ? <Loader2 className="animate-spin" /> : null}
            {t('auto.components.machines.docker.start', 'Start')}
          </Button>
          <Button
            type="button"
            variant="destructive-chip"
            size="xs"
            onClick={() => onAsk('remove')}
          >
            {t('auto.components.machines.docker.remove', 'Remove')}
          </Button>
        </>
      )}
    </div>
  )
}
