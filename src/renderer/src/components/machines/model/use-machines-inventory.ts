import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/index'
import type { MachineOs } from '../../../../../shared/machines/machine-types'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import type { RuntimeHostStatusSnapshot } from '../../../../../shared/remote-runtime/host-status/runtime-host-status'
import {
  buildMachineSummaries,
  type MachineSummary
} from '../../../../../shared/machines/machine-summaries'

function localOs(): MachineOs | null {
  const platform = window.api.platform?.get().platform
  return platform === 'linux' || platform === 'darwin' || platform === 'win32' ? platform : null
}

export type MachinesInventory = {
  machines: MachineSummary[]
  views: readonly MachineView[]
  /** False until the machines and their servers' statuses were first read: every status before that is a guess. */
  loaded: boolean
  reload: () => void
}

/** The stored machines, refetched when a machine, SSH host or server changes; nothing polls. */
export function useMachineViews(): {
  views: readonly MachineView[]
  loaded: boolean
  /** Bumps on every refetch, so callers can refresh what they read beside the list. */
  revision: number
  reload: () => void
} {
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const [views, setViews] = useState<readonly MachineView[]>([])
  const [loaded, setLoaded] = useState(() => !window.api.machines)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false
    void window.api.machines
      ?.list()
      .then((machines) => {
        if (!cancelled) {
          setViews(machines)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [revision, sshTargetLabels])

  useEffect(() => {
    const unsubscribers = [
      window.api.machines?.onChanged(() => reload()),
      window.api.ssh.onTargetRemoved?.(() => reload()),
      window.api.runtimeEnvironments?.onCatalogChanged?.(() => reload())
    ]
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe?.()
      }
    }
  }, [reload])

  return { views, loaded, revision, reload }
}

/** Live machine list; any SSH host or server change anywhere in the app refreshes it. */
export function useMachinesInventory(localName: string): MachinesInventory {
  const sshStates = useAppStore((s) => s.sshConnectionStates)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const { views, loaded: viewsLoaded, revision, reload } = useMachineViews()
  const [runtimeStatuses, setRuntimeStatuses] = useState<Map<string, RuntimeHostStatusSnapshot>>(
    () => new Map()
  )
  const [statusesLoaded, setStatusesLoaded] = useState(() => !window.api.runtimeEnvironments)

  useEffect(() => {
    let cancelled = false
    void window.api.runtimeEnvironments
      ?.getStatusSnapshots()
      .then((snapshots) => {
        if (!cancelled) {
          setRuntimeStatuses(new Map(snapshots.map((s) => [s.environmentId, s])))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setStatusesLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [revision, sshTargetLabels])

  useEffect(
    () =>
      window.api.runtimeEnvironments?.onStatusChanged((snapshot) =>
        setRuntimeStatuses((previous) => new Map(previous).set(snapshot.environmentId, snapshot))
      ),
    []
  )

  const machines = useMemo(
    () =>
      buildMachineSummaries({
        localName,
        localOs: localOs(),
        machines: views,
        sshStates,
        runtimeStatuses
      }),
    [localName, views, sshStates, runtimeStatuses]
  )
  return { machines, views, loaded: viewsLoaded && statusesLoaded, reload }
}
