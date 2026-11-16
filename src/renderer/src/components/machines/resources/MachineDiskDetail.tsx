import React, { useState } from 'react'
import { PageCard } from '@/components/page-layout/PageCard'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslate } from '@/i18n/use-translate'
import { diskMountOfPath } from '../../../../../shared/machines/machine-disk-mount-rules'
import type { MachineDockerStorageKind } from '../../../../../shared/machines/machine-docker-types'
import { MACHINE_DISK_CLEANUP_TARGETS } from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineMetrics } from '../../../../../shared/machines/machine-types'
import { refreshMachineMetrics } from '../model/machine-metrics-store'
import { MachineCleanupSection } from './MachineCleanupSection'
import { MachineDiskLargestList } from './MachineDiskLargestList'
import { MachineDiskMountsCard } from './MachineDiskMountsCard'
import { MachineDiskUsageBrowser } from './MachineDiskUsageBrowser'
import { MachineDockerStorageStats, useMachineDockerStorage } from './MachineDockerStorage'
import { MachineDockerStorageManager } from './MachineDockerStorageManager'
import { useMachineDiskIndex } from './use-machine-disk-index'

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
  const index = useMachineDiskIndex(machineId)
  const docker = useMachineDockerStorage(machineId)
  const dockerStorage = docker.storage
  const reloadDockerStorage = docker.reload
  const [picked, setPicked] = useState<string | null>(null)
  const [tab, setTab] = useState('usage')
  const [dockerKind, setDockerKind] = useState<MachineDockerStorageKind>('images')
  // The drill-down starts where the user's own files are.
  const path = picked ?? metrics?.homeDir ?? null
  const status = index.status
  const mount = diskMountOfPath(status?.mounts ?? [], path)
  const generation = status?.generation ?? 0
  const now = status?.now ?? 0

  const changed = (): void => {
    void index.send({ op: 'rescan' })
    void refreshMachineMetrics(machineId)
    void reloadDockerStorage({ force: true })
  }
  const openFolder = (folder: string): void => {
    setPicked(folder)
    setTab('usage')
  }

  return (
    <div className="space-y-(--page-section-gap)">
      <MachineDiskMountsCard
        index={index}
        activeMount={tab === 'cleanup' ? null : (mount?.mount ?? null)}
        onOpen={(target) => {
          setPicked(target)
          if (tab === 'cleanup') {
            setTab('usage')
          }
        }}
      />
      {dockerStorage?.state === 'ready' && dockerStorage.rows.length > 0 ? (
        <PageCard
          title={t('auto.components.machines.disk.dockerStorage', 'Docker storage')}
          action={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="-mr-1.5"
              onClick={() => setTab('docker')}
              data-machine-docker-manage
            >
              {t('auto.components.machines.disk.dockerManage', 'Manage')}
            </Button>
          }
        >
          <MachineDockerStorageStats
            storage={dockerStorage}
            onPick={(kind) => {
              setDockerKind(kind)
              setTab('docker')
            }}
          />
        </PageCard>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList size="sm">
          <TabsTrigger value="usage">
            {t('auto.components.machines.disk.usageTab', "What's taking space")}
          </TabsTrigger>
          <TabsTrigger value="files">
            {t('auto.components.machines.disk.filesTab', 'Largest files')}
          </TabsTrigger>
          <TabsTrigger value="folders">
            {t('auto.components.machines.disk.foldersTab', 'Largest folders')}
          </TabsTrigger>
          <TabsTrigger value="cleanup">
            {t('auto.components.machines.disk.cleanupTab', 'Clean up')}
          </TabsTrigger>
          <TabsTrigger value="docker">
            {t('auto.components.machines.disk.dockerTab', 'Docker')}
          </TabsTrigger>
        </TabsList>
        {/* Clipped, not scrolled: the Docker table's header and selection bar stick to the panel. */}
        <div className="mt-2 min-w-0 overflow-clip rounded-xl border border-border bg-card">
          <TabsContent value="usage">
            {path ? (
              <MachineDiskUsageBrowser
                machine={machine}
                path={path}
                generation={generation}
                now={now}
                onPath={setPicked}
                onReveal={onReveal}
                onDeleted={changed}
              />
            ) : null}
          </TabsContent>
          {(['files', 'folders'] as const).map((kind) => (
            <TabsContent key={kind} value={kind}>
              {mount ? (
                <MachineDiskLargestList
                  machine={machine}
                  mount={mount.mount}
                  kind={kind}
                  indexed={mount.scannedAt !== null}
                  generation={generation}
                  now={now}
                  onOpenFolder={openFolder}
                  onDeleted={changed}
                />
              ) : null}
            </TabsContent>
          ))}
          <TabsContent value="cleanup">
            <MachineCleanupSection
              machine={machine}
              targets={MACHINE_DISK_CLEANUP_TARGETS}
              onCleaned={changed}
            />
          </TabsContent>
          <TabsContent value="docker">
            <MachineDockerStorageManager
              machine={machine}
              docker={docker}
              category={dockerKind}
              onCategory={setDockerKind}
              onChanged={changed}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
