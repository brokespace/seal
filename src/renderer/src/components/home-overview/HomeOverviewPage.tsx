import { Fragment, useContext, useMemo } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { PageHeader, PageLayout, PageScrollContent } from '@/components/page-layout/PageLayout'
import {
  buildHomeAttentionItems,
  countSessionsByState,
  mergeSessionMachines
} from '../../../../shared/home-overview/home-overview-derivations'
import {
  HomeAccountsContext,
  HomeActionsContext,
  HomeAutomationsContext,
  HomeMachinesContext,
  HomeSessionsContext,
  HomeWorkspacesContext
} from './home-overview-contexts'
import type { HomeOverviewProviders } from './home-overview-model'
import { useHomeNow } from './home-overview-presentation'
import { HomeOverviewProvidersContext } from './home-overview-providers-context'
import { HomeAccountsPanel } from './HomeAccountsPanel'
import { HomeAttentionStrip } from './HomeAttentionStrip'
import { HomeAutomationsPanel } from './HomeAutomationsPanel'
import { HomeChatSlot } from './HomeChatSlot'
import { HomeMachinesPanel } from './HomeMachinesPanel'
import { HomeSessionsPanel } from './HomeSessionsPanel'
import { HomeWorkspacesPanel } from './HomeWorkspacesPanel'

function HomeOverviewContent(): React.JSX.Element {
  const t = useTranslate()
  const now = useHomeNow()
  const sessions = useContext(HomeSessionsContext)
  const providedMachines = useContext(HomeMachinesContext)
  const accounts = useContext(HomeAccountsContext)
  const workspaces = useContext(HomeWorkspacesContext)
  const automations = useContext(HomeAutomationsContext)
  const actions = useContext(HomeActionsContext)
  const machines = useMemo(
    () => mergeSessionMachines(providedMachines, sessions),
    [providedMachines, sessions]
  )
  const attention = useMemo(() => buildHomeAttentionItems(sessions), [sessions])
  const counts = countSessionsByState(sessions)
  const summary = [
    t('home.overview.summary.working', '{{count}} working', { count: counts.working }),
    t('home.overview.summary.waiting', '{{count}} waiting on you', {
      count: counts.waiting + counts.permission
    }),
    t('home.overview.summary.done', '{{count}} done', { count: counts.done })
  ].join(' · ')

  return (
    <PageLayout data-home-page>
      <PageHeader title={t('home.overview.title', 'Home')}>
        <p className="shrink-0 text-xs text-muted-foreground tabular-nums">{summary}</p>
      </PageHeader>
      <PageScrollContent className="gap-4">
        <HomeChatSlot />
        <HomeAttentionStrip items={attention} actions={actions} />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
          <HomeSessionsPanel sessions={sessions} now={now} onOpen={actions.openSession} />
          <div className="flex flex-col gap-4">
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
