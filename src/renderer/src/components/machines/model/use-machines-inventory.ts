import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/index'
import type { MachineOs } from '../../../../../shared/machines/machine-types'
import type { SshTarget } from '../../../../../shared/ssh-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../../shared/remote-runtime/host-catalog/runtime-environments'
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
  sshTargets: readonly SshTarget[]
  reload: () => void
}

export function useMachinesInventory(localName: string): MachinesInventory {
  const sshStates = useAppStore((s) => s.sshConnectionStates)
  // Labels change whenever a host is added, renamed or removed anywhere in the app.
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const [sshTargets, setSshTargets] = useState<readonly SshTarget[]>([])
  const [runtimeEnvironments, setRuntimeEnvironments] = useState<
    readonly PublicKnownRuntimeEnvironment[]
  >([])
  const [runtimeStatuses, setRuntimeStatuses] = useState<Map<string, RuntimeHostStatusSnapshot>>(
    () => new Map()
  )
  const [reloadToken, setReloadToken] = useState(0)
  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    let cancelled = false
    void window.api.ssh
      .listTargets()
      .then((targets) => {
        if (!cancelled) {
          setSshTargets(targets)
        }
      })
      .catch(() => {})
    const runtime = window.api.runtimeEnvironments
    void runtime
      ?.list()
      .then((environments) => {
        if (!cancelled) {
          setRuntimeEnvironments(environments)
        }
      })
      .catch(() => {})
    void runtime
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
        sshTargets,
        sshStates,
        runtimeEnvironments,
        runtimeStatuses
      }),
    [localName, sshTargets, sshStates, runtimeEnvironments, runtimeStatuses]
  )
  return { machines, sshTargets, reload }
}
