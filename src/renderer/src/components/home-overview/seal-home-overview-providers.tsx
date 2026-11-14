import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useLiveSessions } from '@/components/live-sessions/live-session-registry-store'
import {
  useMachineMetricsEntries,
  useMachineMetricsPolling
} from '@/components/machines/model/machine-metrics-store'
import { useLocalMachineName } from '@/components/machines/model/use-local-machine-name'
import { useMachinesInventory } from '@/components/machines/model/use-machines-inventory'
import {
  sealHostSnapshot,
  subscribeSealHost
} from '@/components/seal-session/seal-session-status-store'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { SealAccountsStatus } from '../../../../shared/seal-accounts/seal-accounts-status'
import {
  HomeAccountsContext,
  HomeActionsContext,
  HomeMachinesContext,
  HomeSessionsContext
} from './home-overview-contexts'
import { sealHomeOverviewActions } from './home-overview-actions'
import type { HomeOverviewProviders } from './home-overview-model'
import {
  OrcaMachines,
  orcaHomeOverviewProviders,
  useOrcaAccounts
} from './orca-home-overview-providers'
import { homeMachineFromSummary, mergeSealAccounts } from './seal-home-overview-mapping'

type Children = { children: ReactNode }

const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }

const subscribeLocalSealHost = (listener: () => void): (() => void) =>
  subscribeSealHost(LOCAL_TARGET, listener)

function useLocalSealAccountsStatus(): SealAccountsStatus | null {
  return (
    useSyncExternalStore(subscribeLocalSealHost, () => sealHostSnapshot(LOCAL_TARGET))?.status ??
    null
  )
}

function SealSessions({ children }: Children): React.JSX.Element {
  const { sessions } = useLiveSessions()
  return <HomeSessionsContext.Provider value={sessions}>{children}</HomeSessionsContext.Provider>
}

function MachinesServiceMachines({ children }: Children): React.JSX.Element {
  const localLabel = useLocalMachineName()
  const { machines: summaries } = useMachinesInventory(localLabel)
  useMachineMetricsPolling(summaries)
  const metricsById = useMachineMetricsEntries()
  const machines = useMemo(
    () =>
      summaries.map((summary) =>
        homeMachineFromSummary(summary, metricsById.get(summary.id)?.metrics, localLabel)
      ),
    [summaries, metricsById, localLabel]
  )
  return <HomeMachinesContext.Provider value={machines}>{children}</HomeMachinesContext.Provider>
}

/** The machines service is desktop-only; the web client keeps SSH state and local memory. */
function SealMachines({ children }: Children): React.JSX.Element {
  return window.api.machines ? (
    <MachinesServiceMachines>{children}</MachinesServiceMachines>
  ) : (
    <OrcaMachines>{children}</OrcaMachines>
  )
}

function SealAccounts({ children }: Children): React.JSX.Element {
  const orcaAccounts = useOrcaAccounts()
  const seal = useLocalSealAccountsStatus()
  const accounts = useMemo(() => mergeSealAccounts(orcaAccounts, seal), [orcaAccounts, seal])
  return <HomeAccountsContext.Provider value={accounts}>{children}</HomeAccountsContext.Provider>
}

function SealActions({ children }: Children): React.JSX.Element {
  return (
    <HomeActionsContext.Provider value={sealHomeOverviewActions}>
      {children}
    </HomeActionsContext.Provider>
  )
}

/** Home's data: the live-session registry, the machines service and the account vault. */
export const sealHomeOverviewProviders: HomeOverviewProviders = {
  ...orcaHomeOverviewProviders,
  Sessions: SealSessions,
  Machines: SealMachines,
  Accounts: SealAccounts,
  Actions: SealActions
}
