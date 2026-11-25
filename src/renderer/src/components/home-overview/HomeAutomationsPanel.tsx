import { CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { HomeAutomation, HomeAutomationsResult } from './home-overview-model'
import { formatHomeCountdown } from './home-overview-presentation'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty, HomeOverviewRowButton } from './HomeOverviewRow'

const MAX_AUTOMATION_ROWS = 5

export function HomeAutomationsPanel({
  result,
  now,
  onOpen,
  onOpenAutomation
}: {
  result: HomeAutomationsResult
  now: number
  onOpen: () => void
  onOpenAutomation: (automation: HomeAutomation) => void
}): React.JSX.Element {
  const t = useTranslate()
  const enabled = result.automations.filter((automation) => automation.enabled)
  return (
    <PageCard
      title={t('home.overview.automations.title', 'Automations')}
      action={
        <Button variant="ghost" size="xs" onClick={onOpen}>
          {t('home.overview.automations.open', 'Open')}
        </Button>
      }
    >
      {result.status === 'loading' && result.automations.length === 0 ? (
        <HomeOverviewEmpty>{t('home.overview.automations.loading', 'Loading…')}</HomeOverviewEmpty>
      ) : result.status === 'error' && result.automations.length === 0 ? (
        <HomeOverviewEmpty>
          {t('home.overview.automations.error', 'Automations could not be loaded.')}
        </HomeOverviewEmpty>
      ) : result.automations.length === 0 ? (
        <HomeOverviewEmpty>
          {t(
            'home.overview.automations.empty',
            'No automations. Schedule an agent run to see it here.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <>
          <p className="px-3 pt-2 text-2xs text-muted-foreground tabular-nums">
            {t('home.overview.automations.summary', '{{enabled}} of {{total}} enabled', {
              enabled: enabled.length,
              total: result.automations.length
            })}
          </p>
          <ul className="px-1.5 py-1.5">
            {result.automations.slice(0, MAX_AUTOMATION_ROWS).map((automation) => (
              <li key={automation.id}>
                <HomeOverviewRowButton
                  onClick={() => onOpenAutomation(automation)}
                  className="px-1.5 py-1 text-xs"
                >
                  <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{automation.name}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                    {automation.nextRunAt
                      ? formatHomeCountdown(automation.nextRunAt, now)
                      : t('home.overview.automations.paused', 'Paused')}
                  </span>
                </HomeOverviewRowButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </PageCard>
  )
}
