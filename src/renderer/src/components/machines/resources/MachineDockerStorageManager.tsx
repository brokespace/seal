import React, { useCallback, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { useTranslate } from '@/i18n/use-translate'
import {
  dockerImageKey,
  type MachineDockerDetailTarget,
  type MachineDockerInventory,
  type MachineDockerStorageKind
} from '../../../../../shared/machines/machine-docker-types'
import type { MachineCleanupScan } from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import { MachineCleanupDialog } from './MachineCleanupDialog'
import { MachineDockerCleanUpDialog } from './MachineDockerCleanUpDialog'
import {
  MachineDockerContainerDialog,
  useMachineDockerContainerStart,
  type MachineDockerContainerRequest
} from './MachineDockerContainerDialog'
import { MachineDockerDetailSheet } from './MachineDockerDetailSheet'
import type { MachineDockerStorageState } from './MachineDockerStorage'
import { MachineDockerStorageCategoryTabs } from './MachineDockerStorageCategoryTabs'
import {
  MachineDockerStorageSelectionBar,
  useMachineDockerStorageSelection
} from './MachineDockerStorageSelection'
import { MachineDockerStorageTable } from './MachineDockerStorageTable'
import { MachineDockerStorageToolbar } from './MachineDockerStorageToolbar'
import {
  MachineDockerStorageRefreshButton,
  MachineDockerStorageUnavailable
} from './MachineDockerStorageUnavailable'
import { useMachineDockerStorageCopy } from './machine-docker-storage-copy'
import {
  dockerPruneCandidateCount,
  dockerStorageCategoryTotals,
  dockerStorageItems,
  dockerStorageSelectionTotal,
  dockerStorageSortStartsDescending,
  filterDockerStorageItems,
  MACHINE_DOCKER_STORAGE_KINDS,
  MACHINE_DOCKER_STORAGE_PRUNES,
  sortDockerStorageItems,
  type MachineDockerStorageItem,
  type MachineDockerStoragePrune,
  type MachineDockerStorageSort
} from './machine-docker-storage-rows'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'
import {
  useMachineCleanupCopy,
  useMachineDockerRemovalCopy,
  type MachineCleanupCopy
} from './use-machine-cleanup-copy'

type Sorting = { sort: MachineDockerStorageSort; descending: boolean }

const LARGEST_FIRST: Sorting = { sort: 'size', descending: true }

type Review = {
  scan: MachineCleanupScan
  copy: Pick<MachineCleanupCopy, 'title' | 'removal'>
  heading?: string
}

function detailTargetOf(item: MachineDockerStorageItem): MachineDockerDetailTarget | null {
  switch (item.kind) {
    case 'images':
      return { kind: 'image', id: dockerImageKey(item.image) }
    case 'containers':
      return { kind: 'container', id: item.container.id }
    case 'volumes':
      return { kind: 'volume', id: item.volume.name }
    case 'build-cache':
      return null
  }
}

function ErrorLine({ message }: { message: string }): React.JSX.Element {
  return (
    <p
      className="border-b border-border px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]"
      role="alert"
      data-machine-docker-error
    >
      {message}
    </p>
  )
}

function Inventory({
  machine,
  inventory,
  docker,
  category,
  onCategory,
  onChanged
}: {
  machine: MachineSummary
  inventory: MachineDockerInventory
  docker: MachineDockerStorageState
  category: MachineDockerStorageKind
  onCategory: (kind: MachineDockerStorageKind) => void
  onChanged: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const copy = useMachineDockerStorageCopy()
  const cleanupCopy = useMachineCleanupCopy()
  const removalCopy = useMachineDockerRemovalCopy()
  const machineId = machine.id
  const { reload } = docker
  const [filters, setFilters] = useState<Partial<Record<MachineDockerStorageKind, string>>>({})
  const [reclaimableOnly, setReclaimableOnly] = useState(false)
  const [sorting, setSorting] = useState<Partial<Record<MachineDockerStorageKind, Sorting>>>({})
  const [target, setTarget] = useState<MachineDockerDetailTarget | null>(null)
  const [request, setRequest] = useState<MachineDockerContainerRequest | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [reading, setReading] = useState<'selection' | MachineDockerStoragePrune | null>(null)
  const [cleaningUp, setCleaningUp] = useState(false)
  const reloadNow = useCallback(() => reload({ force: true }), [reload])
  const { starting, start } = useMachineDockerContainerStart(machineId, reloadNow)

  const totals = useMemo(() => dockerStorageCategoryTotals(inventory), [inventory])
  const all = useMemo(() => dockerStorageItems(inventory, category), [inventory, category])
  const filter = filters[category] ?? ''
  const { sort, descending } = sorting[category] ?? LARGEST_FIRST
  const shown = useMemo(
    () =>
      sortDockerStorageItems(
        filterDockerStorageItems(all, { filter, reclaimableOnly }),
        sort,
        descending
      ),
    [all, filter, reclaimableOnly, sort, descending]
  )
  const { selected, select } = useMachineDockerStorageSelection(inventory, category)
  const picked = dockerStorageSelectionTotal(all, selected)

  const openReview = async (
    wanted: 'selection' | MachineDockerStoragePrune,
    read: () => Promise<MachineCleanupScan>,
    reviewOf: (scan: MachineCleanupScan) => Review | null
  ): Promise<void> => {
    if (reading !== null) {
      return
    }
    setReading(wanted)
    try {
      const scan = await read()
      if (scan.unavailable) {
        toast.error(scan.unavailable)
      } else {
        setReview(reviewOf(scan))
      }
    } catch (err) {
      toast.error(resourceErrorText(err))
    }
    setReading(null)
  }
  const removeSelected = (): Promise<void> =>
    openReview(
      'selection',
      () =>
        machineResourceApi().planDockerRemoval({
          machineId,
          kind: category,
          keys: all.filter((item) => selected.has(item.key)).map((item) => item.key)
        }),
      (scan) => ({
        scan,
        copy: { title: cleanupCopy[scan.target].title, removal: removalCopy[category].removal },
        heading: removalCopy[category].title(scan.items.length, machine.label)
      })
    )
  const prune = (wanted: MachineDockerStoragePrune): Promise<void> =>
    openReview(
      wanted,
      () => machineResourceApi().scanCleanup({ machineId, target: wanted }),
      (scan) => {
        if (scan.items.length > 0) {
          return { scan, copy: cleanupCopy[wanted] }
        }
        toast(copy.nothingToPrune[wanted])
        return null
      }
    )

  const reclaimable = inventory.rows.find((row) => row.kind === category)?.reclaimableBytes
  const summary =
    shown.length !== all.length
      ? t('auto.components.machines.dockerStorage.shown', '{{shown}} of {{total}} shown', {
          shown: shown.length,
          total: all.length
        })
      : reclaimable === undefined
        ? ''
        : t('auto.components.machines.docker.storage.reclaimable', '{{size}} can be freed', {
            size: formatBytes(reclaimable)
          })
  const notes = [
    category === 'images' && all.length > 0
      ? t(
          'auto.components.machines.dockerStorage.freesNote',
          'Frees is what removing that image alone gives back. Layers another image shares stay.'
        )
      : null,
    category === 'build-cache' && inventory.buildCacheOmitted > 0
      ? t(
          'auto.components.machines.dockerStorage.buildCacheOmitted',
          'Showing the {{shown}} largest of {{total}} records. Prune build cache removes all unused records.',
          { shown: inventory.buildCache.length, total: totals['build-cache'].count }
        )
      : null
  ].filter(Boolean)

  return (
    <div data-machine-docker-manager={category}>
      <Tabs
        className="gap-0"
        value={category}
        onValueChange={(value) => {
          const kind = MACHINE_DOCKER_STORAGE_KINDS.find((candidate) => candidate === value)
          if (kind) {
            onCategory(kind)
          }
        }}
      >
        <MachineDockerStorageCategoryTabs totals={totals} />
        <TabsContent value={category}>
          <MachineDockerStorageToolbar
            filter={filter}
            filterLabel={t('auto.components.machines.dockerStorage.filter', 'Filter by name or id')}
            onFilter={(next) => setFilters((previous) => ({ ...previous, [category]: next }))}
            reclaimableOnly={reclaimableOnly}
            reclaimableOnlyLabel={copy.reclaimableOnly[category]}
            onReclaimableOnly={setReclaimableOnly}
            summary={summary}
            loading={docker.loading}
            collectedAt={inventory.collectedAt}
            onRefresh={() => void reloadNow()}
            prunes={MACHINE_DOCKER_STORAGE_PRUNES[category].map((wanted) => ({
              target: wanted,
              label: copy.prune[wanted],
              disabled: dockerPruneCandidateCount(inventory, wanted) === 0
            }))}
            scanning={reading === 'selection' ? null : reading}
            onPrune={(wanted) => void prune(wanted)}
            onCleanUp={() => setCleaningUp(true)}
          />
          {docker.error ? <ErrorLine message={docker.error} /> : null}
          {shown.length === 0 ? (
            <p
              className="px-3 py-6 text-center text-xs text-muted-foreground"
              data-machine-docker-empty
            >
              {all.length === 0
                ? copy.empty[category]
                : t('auto.components.machines.dockerStorage.noMatches', 'Nothing matches.')}
            </p>
          ) : (
            <MachineDockerStorageTable
              key={category}
              kind={category}
              items={shown}
              now={inventory.collectedAt}
              sort={sort}
              descending={descending}
              onSort={(next) =>
                setSorting((previous) => ({
                  ...previous,
                  [category]: {
                    sort: next,
                    descending:
                      next === sort ? !descending : dockerStorageSortStartsDescending(next)
                  }
                }))
              }
              selected={selected}
              onToggle={(key) =>
                select((keys) => {
                  if (!keys.delete(key)) {
                    keys.add(key)
                  }
                })
              }
              onToggleAll={(checked) =>
                select((keys) => {
                  for (const item of shown) {
                    if (checked) {
                      keys.add(item.key)
                    } else {
                      keys.delete(item.key)
                    }
                  }
                })
              }
              onOpen={
                category === 'build-cache' ? undefined : (item) => setTarget(detailTargetOf(item))
              }
              starting={starting}
              onStart={(container) => void start(container)}
              onAsk={(container, action) => setRequest({ container, action })}
            />
          )}
          {notes.length > 0 ? (
            <p className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
              {notes.join(' ')}
            </p>
          ) : null}
          {picked.count > 0 ? (
            <MachineDockerStorageSelectionBar
              count={picked.count}
              bytes={picked.bytes}
              reading={reading === 'selection'}
              disabled={reading !== null}
              onClear={() => select((keys) => keys.clear())}
              onRemove={() => void removeSelected()}
            />
          ) : null}
        </TabsContent>
      </Tabs>
      <MachineCleanupDialog
        machine={machine}
        scan={review?.scan ?? null}
        copy={review?.copy ?? null}
        heading={review?.heading}
        onClose={() => setReview(null)}
        onCleaned={onChanged}
      />
      <MachineDockerCleanUpDialog
        machine={machine}
        open={cleaningUp}
        onClose={() => setCleaningUp(false)}
        onCleaned={onChanged}
      />
      <MachineDockerContainerDialog
        machine={machine}
        request={request}
        onClose={() => setRequest(null)}
        onDone={onChanged}
      />
      <MachineDockerDetailSheet
        machine={machine}
        target={target}
        onTarget={setTarget}
        onChanged={onChanged}
      />
    </div>
  )
}

/**
 * Everything Docker keeps on a machine's disk, by kind: what is unused, what removing it frees,
 * and the ways to remove it. Every removal goes through a confirmation that lists it.
 */
export function MachineDockerStorageManager({
  machine,
  docker,
  category,
  onCategory,
  onChanged
}: {
  machine: MachineSummary
  docker: MachineDockerStorageState
  category: MachineDockerStorageKind
  onCategory: (kind: MachineDockerStorageKind) => void
  /** Something was removed or stopped: the disk figures around this view are stale. */
  onChanged: () => void
}): React.JSX.Element {
  const { storage, loading, error, reload } = docker
  const refresh = (): void => void reload({ force: true })
  if (storage === null) {
    return error ? (
      <div data-machine-docker-manager="failed">
        <ErrorLine message={error} />
        <div className="px-3 py-3">
          <MachineDockerStorageRefreshButton loading={loading} onRefresh={refresh} />
        </div>
      </div>
    ) : (
      <div className="flex h-16 items-center justify-center" data-machine-docker-manager="loading">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (storage.state !== 'ready') {
    return (
      <div data-machine-docker-manager="unavailable">
        {error ? <ErrorLine message={error} /> : null}
        <MachineDockerStorageUnavailable
          machine={machine}
          docker={storage}
          loading={loading}
          onRefresh={refresh}
        />
      </div>
    )
  }
  return (
    <Inventory
      machine={machine}
      inventory={storage}
      docker={docker}
      category={category}
      onCategory={onCategory}
      onChanged={onChanged}
    />
  )
}
