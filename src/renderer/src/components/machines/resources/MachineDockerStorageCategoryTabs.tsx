import React from 'react'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MachineDockerStorageKind } from '../../../../../shared/machines/machine-docker-types'
import { formatBytes } from '../model/machine-format'
import { useMachineDockerStorageCopy } from './machine-docker-storage-copy'
import { MACHINE_DOCKER_STORAGE_KINDS } from './machine-docker-storage-rows'

/** The switcher between the kinds of Docker data; belongs inside the manager's `Tabs`. */
export function MachineDockerStorageCategoryTabs({
  totals
}: {
  totals: Record<MachineDockerStorageKind, { count: number; sizeBytes: number }>
}): React.JSX.Element {
  const copy = useMachineDockerStorageCopy()
  return (
    <div className="scrollbar-none overflow-x-auto border-b border-border px-1.5 pt-1 pb-[5px]">
      <TabsList variant="line" size="sm">
        {MACHINE_DOCKER_STORAGE_KINDS.map((kind) => (
          <TabsTrigger key={kind} value={kind} data-machine-docker-category={kind}>
            {copy.kind[kind]}
            <span className="font-normal text-muted-foreground tabular-nums">
              {totals[kind].count}
              <span className="@max-xl:hidden">{` · ${formatBytes(totals[kind].sizeBytes)}`}</span>
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  )
}
