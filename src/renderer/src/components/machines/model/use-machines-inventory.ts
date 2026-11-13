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
  reload: () => void
}

/** Live machine list; any SSH host or server change anywhere in the app refreshes it. */
export function useMachinesInventory(localName: string): MachinesInventory {
  const sshStates = useAppStore((s) => s.sshConnectionStates)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const [views, setViews] = useState<readonly MachineView[]>([])
  const [runtimeStatuses, setRuntimeStatuses] = useState<Map<string, RuntimeHostStatusSnapshot>>(
    () => new Map()
  )
  const [reloadToken, setReloadToken] = useState(0)
  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

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
    void window.api.runtimeEnvironments
      ?.getStatusSnapshots()
      .then((snapshots) => {
        if (!cancelled) {
          setRuntimeStatuses(new Map(snapshots.map((s) => [s.environmentId, s])))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [reloadToken, sshTargetLabels])

  useEffect(() => {
    const unsubscribers = [
      window.api.machines?.onChanged(() => reload()),
      window.api.ssh.onTargetRemoved?.(() => reload()),
      window.api.runtimeEnvironments?.onCatalogChanged?.(() => reload()),
      window.api.runtimeEnvironments?.onStatusChanged((snapshot) =>
        setRuntimeStatuses((previous) => new Map(previous).set(snapshot.environmentId, snapshot))
      )
    ]
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe?.()
      }
    }
  }, [reload])

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
  return { machines, views, reload }
}
