import React, { useState } from 'react'
import { PageSection } from '@/components/page-layout/PageCard'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineDockerDetailTarget,
  MachineDockerImageDetails
} from '../../../../../shared/machines/machine-docker-types'
import { formatBytes } from '../model/machine-format'
import { MachineDockerContainerRefs } from './MachineDockerContainerRefs'
import {
  MachineDockerCopyButton,
  MachineDockerFact,
  MachineDockerFacts,
  MachineDockerTime
} from './MachineDockerDetailFacts'
import { dockerLayerStep, MACHINE_DOCKER_LAYERS_SHOWN } from './machine-docker-image-layers'

/** One image: its tags and size, the containers made from it, and the layers it is built of. */
export function MachineDockerImageDetail({
  details,
  onTarget
}: {
  details: MachineDockerImageDetails
  onTarget: (target: MachineDockerDetailTarget) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [allLayers, setAllLayers] = useState(false)
  // Docker gives a layer no id of its own; its height above the base image names it.
  const layers = details.layers
    .map((layer, fromTop) => ({ layer, fromTop, height: details.layers.length - fromTop }))
    .slice(0, allLayers ? undefined : MACHINE_DOCKER_LAYERS_SHOWN)
  const platform = [details.os, details.architecture].filter(Boolean).join('/')
  return (
    <div className="space-y-5" data-machine-docker-image-detail={details.id}>
      <PageSection label={t('auto.components.machines.dockerDetails.image', 'Image')}>
        <MachineDockerFacts>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.tags', 'Tags')}
            mono={details.tags.length > 0}
          >
            {details.tags.length > 0 ? (
              <ul>
                {details.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                {t('auto.components.machines.dockerDetails.untagged', 'Untagged')}
              </span>
            )}
          </MachineDockerFact>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.id', 'ID')} mono>
            <span title={details.id}>{details.id.replace(/^sha256:/, '').slice(0, 12)}</span>
            <MachineDockerCopyButton
              text={details.id}
              label={t('auto.components.machines.dockerDetails.copyId', 'Copy the full ID')}
            />
          </MachineDockerFact>
          {details.digests.length > 0 ? (
            <MachineDockerFact
              label={t('auto.components.machines.dockerDetails.digests', 'Digests')}
              mono
            >
              <ul className="break-all">
                {details.digests.map((digest) => (
                  <li key={digest}>{digest}</li>
                ))}
              </ul>
            </MachineDockerFact>
          ) : null}
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.size', 'Size')} mono>
            {formatBytes(details.sizeBytes)}
          </MachineDockerFact>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.created', 'Created')}>
            <MachineDockerTime at={details.createdAt} />
          </MachineDockerFact>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.platform', 'Platform')}
            mono
          >
            {platform || '—'}
          </MachineDockerFact>
        </MachineDockerFacts>
      </PageSection>

      <PageSection
        label={t('auto.components.machines.dockerDetails.usedBy', 'Containers that use it')}
      >
        <MachineDockerContainerRefs
          containers={details.containers}
          empty={t(
            'auto.components.machines.dockerDetails.imageUnused',
            'No container was made from this image.'
          )}
          onTarget={onTarget}
        />
      </PageSection>

      <PageSection
        label={t('auto.components.machines.dockerDetails.layers', 'Layers')}
        caption={
          <>
            {t('auto.components.machines.dockerDetails.layers', 'Layers')}
            <span className="ml-1.5 font-normal tracking-normal normal-case">
              {t('auto.components.machines.dockerDetails.newestFirst', 'newest first')}
            </span>
          </>
        }
      >
        {details.layers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(
              'auto.components.machines.dockerDetails.noLayers',
              'Docker lists no build history for this image.'
            )}
          </p>
        ) : (
          <ol className="divide-y divide-border/60 rounded-md border border-border text-xs">
            {layers.map(({ layer, fromTop, height }) => {
              const step = dockerLayerStep(layer.createdBy)
              return (
                <li
                  key={height}
                  className="flex items-start gap-3 px-2.5 py-1.5"
                  data-machine-docker-layer={fromTop}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="line-clamp-2 font-mono text-2xs [overflow-wrap:anywhere]"
                      title={step}
                    >
                      {step}
                    </div>
                    <div className="text-2xs text-muted-foreground">
                      <MachineDockerTime at={layer.createdAt} />
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 font-mono tabular-nums',
                      !layer.sizeBytes && 'text-muted-foreground'
                    )}
                  >
                    {formatBytes(layer.sizeBytes)}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
        {details.layers.length > layers.length ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="self-start"
            onClick={() => setAllLayers(true)}
          >
            {t('auto.components.machines.dockerDetails.showAllLayers', 'Show all {{count}}', {
              count: details.layers.length
            })}
          </Button>
        ) : null}
      </PageSection>
    </div>
  )
}
