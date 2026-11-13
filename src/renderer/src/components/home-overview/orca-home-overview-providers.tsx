import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppStore } from '@/store'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { useLiveDashboardSnapshot } from '@/components/dashboard/useLiveDashboardSnapshot'
import { revealDashboardAgent } from '@/components/dashboard/reveal-dashboard-agent'
import { AUTOMATIONS_CHANGED_EVENT } from '@/components/automations/events/automations-changed-window-event'
import { listAutomationsForTarget } from '@/components/automations/hosts/automation-host-client'
import {
  EMPTY_DASHBOARD_SNAPSHOT,
  type DashboardSnapshot
} from '../../../../shared/dashboard-snapshot'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import type { HostMemory } from '../../../../shared/process-stats-types'
import type {
  HomeAutomationsResult,
  HomeMachine,
  HomeOverviewActions,
  HomeOverviewProviders,
  HomeSession
} from './home-overview-model'
import { orcaHomeSessionFromCard } from './orca-home-session-mapping'
import { orcaActiveAccountsByAgent, orcaHomeAccounts } from './orca-home-account-mapping'
import { orcaLocalMachine, orcaSshMachines } from './orca-home-machine-mapping'
import { orcaHomeAutomations, orcaHomeWorkspaces } from './orca-home-workspace-mapping'

const HOST_LOAD_POLL_MS = 10_000

const OrcaSnapshotContext = createContext<DashboardSnapshot>(EMPTY_DASHBOARD_SNAPSHOT)

/** Builds the dashboard snapshot once for both the sessions and workspaces hooks. */
function OrcaHomeRoot({ children }: { children: ReactNode }): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()
  return <OrcaSnapshotContext.Provider value={snapshot}>{children}</OrcaSnapshotContext.Provider>
}

function useOrcaSessions(): HomeSession[] {
  const snapshot = useContext(OrcaSnapshotContext)
  const live = useAppStore((s) => s.agentStatusByPaneKey)
  const retained = useAppStore((s) => s.retainedAgentsByPaneKey)
  const settings = useAppStore((s) => s.settings)
  return useMemo(() => {
    const context = {
      localMachineLabel: getLocalExecutionHostLabel(),
      activeAccounts: orcaActiveAccountsByAgent(settings)
    }
    return snapshot.cards.map((card) =>
      orcaHomeSessionFromCard(card, live[card.paneKey] ?? retained[card.paneKey]?.entry, context)
    )
  }, [snapshot, live, retained, settings])
}

function useLocalHostMemory(): HostMemory | null {
  const [host, setHost] = useState<HostMemory | null>(
    () => useAppStore.getState().memorySnapshot?.host ?? null
  )
  useEffect(() => {
    let disposed = false
    const run = (): void => {
      window.api.memory
        .getSnapshot()
        .then((snapshot) => {
          if (!disposed) {
            setHost(snapshot.host)
          }
        })
        .catch(() => {})
    }
    run()
    const stop = installWindowVisibilityInterval({
      run,
      intervalMs: HOST_LOAD_POLL_MS,
      slowWhileUnfocused: true
    })
    return () => {
      disposed = true
      stop()
    }
  }, [])
  return host
}

function useOrcaMachines(): HomeMachine[] {
  const labels = useAppStore((s) => s.sshTargetLabels)
  const states = useAppStore((s) => s.sshConnectionStates)
  const host = useLocalHostMemory()
  return useMemo(
    () => [
      orcaLocalMachine({
        label: getLocalExecutionHostLabel(),
        host,
        loadAverageSupported: !navigator.userAgent.includes('Windows')
      }),
      ...orcaSshMachines(labels, states)
    ],
    [labels, states, host]
  )
}

function useOrcaAccounts(): ReturnType<typeof orcaHomeAccounts> {
  const rateLimits = useAppStore((s) => s.rateLimits)
  const settings = useAppStore((s) => s.settings)
  return useMemo(() => orcaHomeAccounts(rateLimits, settings), [rateLimits, settings])
}

function useOrcaWorkspaces(): ReturnType<typeof orcaHomeWorkspaces> {
  const snapshot = useContext(OrcaSnapshotContext)
  return useMemo(() => orcaHomeWorkspaces(snapshot.workspaces ?? []), [snapshot])
}

function useOrcaAutomations(): HomeAutomationsResult {
  const [result, setResult] = useState<HomeAutomationsResult>({
    automations: [],
    status: 'loading'
  })
  useEffect(() => {
    let disposed = false
    const load = (): void => {
      listAutomationsForTarget({ kind: 'local' })
        .then((automations) => {
          if (!disposed) {
            setResult({ automations: orcaHomeAutomations(automations), status: 'ready' })
          }
        })
        .catch(() => {
          if (!disposed) {
            setResult((current) => ({ ...current, status: 'error' }))
          }
        })
    }
    load()
    window.addEventListener(AUTOMATIONS_CHANGED_EVENT, load)
    return () => {
      disposed = true
      window.removeEventListener(AUTOMATIONS_CHANGED_EVENT, load)
    }
  }, [])
  return result
}

function useOrcaActions(): HomeOverviewActions {
  const openAutomationsPage = useAppStore((s) => s.openAutomationsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  return useMemo(
    () => ({
      openSession: (session) => {
        if (session.target.kind === 'orca-pane') {
          revealDashboardAgent(session.target.reveal)
        }
      },
      openAutomations: openAutomationsPage,
      openMachinesSettings: () => openSettingsTarget({ pane: 'servers', repoId: null }),
      openAccountsSettings: () => openSettingsTarget({ pane: 'accounts', repoId: null })
    }),
    [openAutomationsPage, openSettingsTarget]
  )
}

/** Home backed by what Orca tracks today; swap pieces as dedicated registries land. */
export const orcaHomeOverviewProviders: HomeOverviewProviders = {
  Root: OrcaHomeRoot,
  sessions: { useSessions: useOrcaSessions },
  machines: { useMachines: useOrcaMachines },
  accounts: { useAccounts: useOrcaAccounts },
  workspaces: { useWorkspaces: useOrcaWorkspaces },
  automations: { useAutomations: useOrcaAutomations },
  useActions: useOrcaActions
}
