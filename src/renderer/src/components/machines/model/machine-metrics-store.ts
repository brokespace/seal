import { useEffect, useSyncExternalStore } from 'react'
import {
  parseMachineId,
  type MachineId,
  type MachineMetrics
} from '../../../../../shared/machines/machine-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

const METRICS_POLL_MS = 15_000

type MetricsEntry = { metrics: MachineMetrics | null; error: string | null }

let entries: ReadonlyMap<MachineId, MetricsEntry> = new Map()
const listeners = new Set<() => void>()
const inflight = new Set<MachineId>()

function publish(machineId: MachineId, entry: MetricsEntry): void {
  entries = new Map(entries).set(machineId, entry)
  for (const listener of listeners) {
    listener()
  }
}

export async function refreshMachineMetrics(machineId: MachineId): Promise<void> {
  const api = window.api.machines
  if (!api || inflight.has(machineId)) {
    return
  }
  inflight.add(machineId)
  try {
    publish(machineId, { metrics: await api.getMetrics({ machineId }), error: null })
  } catch (error) {
    publish(machineId, {
      metrics: entries.get(machineId)?.metrics ?? null,
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    inflight.delete(machineId)
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMachineMetricsEntries(): ReadonlyMap<MachineId, MetricsEntry> {
  return useSyncExternalStore(subscribe, () => entries)
}

/** Polls every online machine that reports metrics while the Machines page is mounted. */
export function useMachineMetricsPolling(machines: readonly MachineSummary[]): void {
  const pollable = machines
    .filter((machine) => machine.status === 'online')
    .map((machine) => machine.id)
    .join('\n')
  useEffect(() => {
    const ids = pollable.split('\n').flatMap((value) => parseMachineId(value) ?? [])
    if (ids.length === 0) {
      return
    }
    const poll = (): void => {
      for (const id of ids) {
        void refreshMachineMetrics(id)
      }
    }
    poll()
    return installWindowVisibilityInterval({
      run: poll,
      intervalMs: METRICS_POLL_MS,
      slowWhileUnfocused: true
    })
  }, [pollable])
}
