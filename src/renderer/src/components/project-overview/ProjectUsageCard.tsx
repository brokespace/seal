import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty } from '@/components/home-overview/HomeOverviewRow'
import { formatCost, formatTokens } from '@/components/stats/usage-formatters'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type { ProjectUsageTotals } from './project-overview-model'
import { useProjectUsage } from './use-project-usage'

function ProviderUsage({
  name,
  usage
}: {
  name: string
  usage: ProjectUsageTotals | 'none'
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
      <dt className="shrink-0 font-medium text-foreground">{name}</dt>
      <dd className="min-w-0 truncate text-right text-muted-foreground tabular-nums">
        {usage === 'none'
          ? t('seal.projectOverview.usage.none', 'No usage')
          : [
              t('seal.projectOverview.usage.sessions', '{{count}} sessions', {
                count: usage.sessions,
                defaultValue_one: '{{count}} session'
              }),
              t('seal.projectOverview.usage.tokens', '{{input}} in / {{output}} out', {
                input: formatTokens(usage.inputTokens),
                output: formatTokens(usage.outputTokens)
              }),
              usage.estimatedCostUsd === null ? null : formatCost(usage.estimatedCostUsd)
            ]
              .filter(Boolean)
              .join(' · ')}
      </dd>
    </div>
  )
}

/** What the project's agents used in the last 30 days, from the usage logs on this computer. */
export function ProjectUsageCard({ repo }: { repo: Repo }): React.JSX.Element {
  const t = useTranslate()
  const usage = useProjectUsage(repo.id)
  const isLocal = getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
  const openStats = (): void => {
    const state = useAppStore.getState()
    state.openSettingsTarget({ pane: 'stats', repoId: null })
    state.openSettingsPage()
  }
  return (
    <PageCard
      title={t('seal.projectOverview.usage.title', 'Usage · 30 days')}
      action={
        <Button type="button" variant="ghost" size="xs" onClick={openStats}>
          {t('seal.projectOverview.usage.details', 'Details')}
        </Button>
      }
    >
      {!isLocal ? (
        <HomeOverviewEmpty>
          {t(
            'seal.projectOverview.usage.remote',
            'Usage is read from this computer’s logs, so it is not available for a project on another machine.'
          )}
        </HomeOverviewEmpty>
      ) : usage.status === 'loading' ? (
        <HomeOverviewEmpty>
          {t('seal.projectOverview.usage.loading', 'Loading usage…')}
        </HomeOverviewEmpty>
      ) : usage.status === 'error' ? (
        <HomeOverviewEmpty>
          {t('seal.projectOverview.usage.unavailable', 'Usage could not be read.')}
        </HomeOverviewEmpty>
      ) : usage.data.claude === null && usage.data.codex === null ? (
        <HomeOverviewEmpty>
          {t(
            'seal.projectOverview.usage.off',
            'Usage tracking is off. Turn it on in Stats to see what this project costs.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <dl className="space-y-1.5 px-3 py-2.5" data-project-overview-usage>
          {usage.data.claude !== null ? (
            <ProviderUsage name="Claude" usage={usage.data.claude} />
          ) : null}
          {usage.data.codex !== null ? (
            <ProviderUsage name="Codex" usage={usage.data.codex} />
          ) : null}
        </dl>
      )}
    </PageCard>
  )
}
