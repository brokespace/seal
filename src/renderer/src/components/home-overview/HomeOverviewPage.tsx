import { Fragment, useContext, useMemo } from 'react'
import { useTranslate } from '@/i18n/use-translate'
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
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-8 pt-6 pb-16">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold text-foreground">
            {t('home.overview.title', 'Home')}
          </h1>
          <p className="text-xs text-muted-foreground tabular-nums">{summary}</p>
        </header>
        <HomeChatSlot />
        <HomeAttentionStrip items={attention} actions={actions} />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <HomeSessionsPanel sessions={sessions} now={now} onOpen={actions.openSession} />
          <div className="flex flex-col gap-4">
            <HomeMachinesPanel
              machines={machines}
              sessions={sessions}
              onManage={actions.openMachines}
              onOpen={actions.openMachine}
            />
            <HomeAccountsPanel
              accounts={accounts}
              now={now}
              onManage={actions.openAccountsSettings}
            />
            <HomeWorkspacesPanel workspaces={workspaces} onOpen={actions.openWorkspace} />
            <HomeAutomationsPanel
              result={automations}
              now={now}
              onOpen={actions.openAutomations}
              onOpenAutomation={actions.openAutomation}
            />
          </div>
        </div>
      </div>
    </div>
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
