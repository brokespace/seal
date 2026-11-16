import React from 'react'
import { PageSection } from '@/components/page-layout/PageCard'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineDockerDetailTarget,
  MachineDockerVolumeDetails
} from '../../../../../shared/machines/machine-docker-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { MachineDockerContainerRefs } from './MachineDockerContainerRefs'
import {
  MachineDockerCopyButton,
  MachineDockerFact,
  MachineDockerFacts,
  MachineDockerTime
} from './MachineDockerDetailFacts'
import { MachineDockerVolumeFiles } from './MachineDockerVolumeFiles'

function Pairs({
  pairs,
  empty
}: {
  pairs: Record<string, string>
  empty: string
}): React.JSX.Element {
  const entries = Object.entries(pairs)
  if (entries.length === 0) {
    return <span className="text-muted-foreground">{empty}</span>
  }
  return (
    <ul className="space-y-0.5 font-mono break-all">
      {entries.map(([key, value]) => (
        <li key={key}>
          <span className="text-muted-foreground">{`${key}=`}</span>
          {value}
        </li>
      ))}
    </ul>
  )
}

/** One volume: where it lives, which containers mount it, and its files to look through. */
export function MachineDockerVolumeDetail({
  machine,
  details,
  revision,
  onTarget
}: {
  machine: MachineSummary
  details: MachineDockerVolumeDetails
  /** Changes whenever the details were asked for again. */
  revision: number
  onTarget: (target: MachineDockerDetailTarget) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="space-y-5" data-machine-docker-volume-detail={details.name}>
      <PageSection label={t('auto.components.machines.dockerDetails.volume', 'Volume')}>
        <MachineDockerFacts>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.name', 'Name')} mono>
            {details.name}
          </MachineDockerFact>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.driver', 'Driver')}
            mono
          >
            {details.driver}
          </MachineDockerFact>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.mountpoint', 'Mountpoint')}
            mono
          >
            {details.mountpoint}
            <MachineDockerCopyButton
              text={details.mountpoint}
              label={t(
                'auto.components.machines.dockerDetails.copyMountpoint',
                'Copy the mountpoint'
              )}
            />
          </MachineDockerFact>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.scope', 'Scope')}
            mono
          >
            {details.scope ?? '—'}
          </MachineDockerFact>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.created', 'Created')}>
            <MachineDockerTime at={details.createdAt} />
          </MachineDockerFact>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.labels', 'Labels')}>
            <Pairs
              pairs={details.labels}
              empty={t('auto.components.machines.dockerDetails.noLabels', 'No labels')}
            />
          </MachineDockerFact>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.options', 'Options')}>
            <Pairs
              pairs={details.options}
              empty={t('auto.components.machines.dockerDetails.noOptions', 'No options')}
            />
          </MachineDockerFact>
        </MachineDockerFacts>
      </PageSection>

      <PageSection
        label={t('auto.components.machines.dockerDetails.usedBy', 'Containers that use it')}
      >
        <MachineDockerContainerRefs
          containers={details.containers}
          empty={t(
            'auto.components.machines.dockerDetails.volumeUnused',
            'No container mounts this volume.'
          )}
          detail={(container) => (
            <>
              {container.destination ? (
                <span className="truncate font-mono" title={container.destination}>
                  {container.destination}
                </span>
              ) : null}
              {container.readOnly ? (
                <Badge variant="referenceLabel">
                  {t('auto.components.machines.dockerDetails.readOnly', 'ro')}
                </Badge>
              ) : null}
            </>
          )}
          onTarget={onTarget}
        />
      </PageSection>

      <PageSection label={t('auto.components.machines.dockerDetails.files', 'Files (read-only)')}>
        <MachineDockerVolumeFiles machine={machine} volume={details.name} revision={revision} />
      </PageSection>
    </div>
  )
}
