import { Fragment, useContext, useMemo } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { PageHeader, PageLayout, PageScrollContent } from '@/components/page-layout/PageLayout'
import { PageCardGrid } from '@/components/page-layout/PageCard'
import { isActiveLiveSession } from '../../../../shared/live-sessions/live-session-status'
import { mergeSessionMachines } from '../../../../shared/home-overview/home-overview-derivations'
import {
  HomeAccountsContext,
  HomeActionsContext,
  HomeAutomationsContext,
  HomeMachinesContext,
  HomeSessionsContext,
  HomeWorkspacesContext
} from './home-overview-contexts'
import type { HomeOverviewProviders } from './home-overview-model'
import { useLiveSessionCountsLine } from '../live-sessions/status/use-live-session-counts-line'
import { useHomeNow } from './home-overview-presentation'
import { HomeOverviewProvidersContext } from './home-overview-providers-context'
import { HomeAccountsPanel } from './HomeAccountsPanel'
import { HomeAutomationsPanel } from './HomeAutomationsPanel'
import { HomeChatSlot } from './HomeChatSlot'
import { HomeMachinesPanel } from './HomeMachinesPanel'
import { HomeSessionsPanel } from './HomeSessionsPanel'
import { HomeWorkspacesPanel } from './HomeWorkspacesPanel'

function HomeOverviewContent(): React.JSX.Element {
  const t = useTranslate()
  const now = useHomeNow()
  const registrySessions = useContext(HomeSessionsContext)
  const sessions = useMemo(() => registrySessions.filter(isActiveLiveSession), [registrySessions])
  const providedMachines = useContext(HomeMachinesContext)
  const accounts = useContext(HomeAccountsContext)
  const workspaces = useContext(HomeWorkspacesContext)
  const automations = useContext(HomeAutomationsContext)
  const actions = useContext(HomeActionsContext)
  const machines = useMemo(
    () => mergeSessionMachines(providedMachines, sessions),
    [providedMachines, sessions]
  )
  const summary = useLiveSessionCountsLine(sessions)

  return (
    <PageLayout data-home-page>
      <PageHeader title={t('home.overview.title', 'Home')}>
        <p className="shrink-0 text-xs text-muted-foreground tabular-nums">{summary}</p>
      </PageHeader>
      <PageScrollContent
        // Wide windows put an open chat beside the overview; otherwise the overview has the row.
        className="grid grid-cols-1 items-start @min-[96rem]/page:has-[[data-home-slot=chat]:not([data-minimized])]:grid-cols-[minmax(0,1fr)_minmax(26rem,36%)]"
      >
        <HomeChatSlot />
        <div className="@container/overview flex min-w-0 flex-col gap-(--page-section-gap)">
          <div className="grid grid-cols-1 items-start gap-(--page-section-gap) @min-[56rem]/overview:grid-cols-[minmax(0,1fr)_20rem]">
            <HomeSessionsPanel sessions={sessions} now={now} />
            <PageCardGrid>
              <HomeMachinesPanel
                machines={machines}
                sessions={sessions}
                onManage={actions.openMachines}
                onOpen={actions.openMachine}
              />
              <HomeAccountsPanel accounts={accounts} onManage={actions.openAccountsSettings} />
              <HomeWorkspacesPanel workspaces={workspaces} onOpen={actions.openWorkspace} />
              <HomeAutomationsPanel
                result={automations}
                now={now}
                onOpen={actions.openAutomations}
                onOpenAutomation={actions.openAutomation}
              />
            </PageCardGrid>
          </div>
        </div>
      </PageScrollContent>
    </PageLayout>
  )
}

export function HomeOverview({
  providers
}: {
  providers: HomeOverviewProviders
}): React.JSX.Element {
  const {
    Root = Fragment,
    Sessions,
    Machines,
    Accounts,
    Workspaces,
    Automations,
    Actions
  } = providers
  return (
    <Root>
      <Sessions>
        <Machines>
          <Accounts>
            <Workspaces>
              <Automations>
                <Actions>
                  <HomeOverviewContent />
                </Actions>
              </Automations>
            </Workspaces>
          </Accounts>
        </Machines>
      </Sessions>
    </Root>
  )
}

export default function HomeOverviewPage(): React.JSX.Element {
  return <HomeOverview providers={useContext(HomeOverviewProvidersContext)} />
}
