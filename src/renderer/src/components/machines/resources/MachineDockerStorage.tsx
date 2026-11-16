import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type {
  MachineDockerStorage,
  MachineDockerStorageKind
} from '../../../../../shared/machines/machine-docker-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { formatBytes } from '../model/machine-format'
import { MachineResourceStat, MachineResourceStats } from './MachineResourceStat'
import { useMachineDockerStorageCopy } from './machine-docker-storage-copy'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

/** `docker system df` is slow on a busy daemon, and the figures move slowly. */
const STORAGE_REFRESH_MS = 30_000

export type MachineDockerStorageState = {
  /** The last answer; it stays while a later read fails. Null until the first one. */
  storage: MachineDockerStorage | null
  loading: boolean
  /** Why the latest read failed. */
  error: string | null
  /** `force` reads the machine again instead of taking a shared recent answer. */
  reload: (options?: { force?: boolean }) => Promise<void>
}

type Answer = { machineId: MachineId; storage: MachineDockerStorage | null; error: string | null }

/** What Docker holds on a machine's disk, kept current while the window is visible. */
export function useMachineDockerStorage(machineId: MachineId): MachineDockerStorageState {
  const [answer, setAnswer] = useState<Answer>({ machineId, storage: null, error: null })
  const [inFlight, setInFlight] = useState(0)
  const latest = useRef(0)
  const forced = useRef(0)

  const reload = useCallback(
    async (options?: { force?: boolean }): Promise<void> => {
      const force = options?.force === true
      // A shared answer from before a change must not replace the fresh read after it.
      if (!force && forced.current > 0) {
        return
      }
      const request = ++latest.current
      forced.current += force ? 1 : 0
      setInFlight((count) => count + 1)
      try {
        const storage = await machineResourceApi().dockerStorage(
          force ? { machineId, force } : { machineId }
        )
        if (request === latest.current) {
          setAnswer({ machineId, storage, error: null })
        }
      } catch (err) {
        if (request === latest.current) {
          setAnswer((previous) => ({
            machineId,
            storage: previous.machineId === machineId ? previous.storage : null,
            error: resourceErrorText(err)
          }))
        }
      } finally {
        forced.current -= force ? 1 : 0
        setInFlight((count) => count - 1)
      }
    },
    [machineId]
  )
  useEffect(
    () =>
      installWindowVisibilityInterval({ run: () => void reload(), intervalMs: STORAGE_REFRESH_MS }),
    [reload]
  )
  const current = answer.machineId === machineId ? answer : null
  return {
    storage: current?.storage ?? null,
    loading: inFlight > 0,
    error: current?.error ?? null,
    reload
  }
}

/** Disk space per kind of Docker object, with what pruning that kind would free. */
export function MachineDockerStorageStats({
  storage,
  onPick
}: {
  storage: MachineDockerStorage | null
  /** Makes each figure a button that opens that kind. */
  onPick?: (kind: MachineDockerStorageKind) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const labels = useMachineDockerStorageCopy().kind
  if (storage?.state !== 'ready' || storage.rows.length === 0) {
    return null
  }
  return (
    <div className={onPick ? 'px-1.5 py-1' : 'px-3 py-2.5'} data-machine-docker-storage>
      <MachineResourceStats>
        {storage.rows.map((row) => {
          const stat = (
            <MachineResourceStat
              key={row.kind}
              label={`${labels[row.kind]} · ${row.count}`}
              value={formatBytes(row.sizeBytes)}
              detail={t(
                'auto.components.machines.docker.storage.reclaimable',
                '{{size}} can be freed',
                {
                  size: formatBytes(row.reclaimableBytes)
                }
              )}
            />
          )
          return onPick ? (
            <button
              key={row.kind}
              type="button"
              className="min-w-0 rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              data-machine-docker-storage-stat={row.kind}
              onClick={() => onPick(row.kind)}
            >
              {stat}
            </button>
          ) : (
            stat
          )
        })}
      </MachineResourceStats>
    </div>
  )
}
