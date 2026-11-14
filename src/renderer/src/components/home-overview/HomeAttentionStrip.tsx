import { AgentStateDot } from '@/components/AgentStateDot'
import { PageSection } from '@/components/page-layout/PageCard'
import { useTranslate } from '@/i18n/use-translate'
import type { HomeAttentionItem } from '../../../../shared/home-overview/home-overview-derivations'
import type { HomeOverviewActions } from './home-overview-model'
import { homeSessionDotState, homeSessionStateLabel } from './home-overview-presentation'

const CHIP_CLASS =
  'flex max-w-72 min-w-0 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function AttentionChip({
  item,
  actions
}: {
  item: HomeAttentionItem
  actions: HomeOverviewActions
}): React.JSX.Element {
  const t = useTranslate()
  const { session, reason } = item
  const label = homeSessionStateLabel(session.state, t)
  return (
    <button
      type="button"
      className={CHIP_CLASS}
      title={reason ?? undefined}
      onClick={() => actions.openSession(session)}
    >
      <AgentStateDot state={homeSessionDotState(session.state)} title={null} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{session.title}</span>
        <span className="block truncate text-2xs text-muted-foreground">
          {reason ? `${label}: ${reason}` : label} · {session.machineLabel}
        </span>
      </span>
    </button>
  )
}

export function HomeAttentionStrip({
  items,
  actions
}: {
  items: readonly HomeAttentionItem[]
  actions: HomeOverviewActions
}): React.JSX.Element {
  const t = useTranslate()
  const label = t('home.overview.attention.title', 'Needs attention')
  return (
    <PageSection
      inline
      label={label}
      caption={
        <>
          {label}
          <span className="ml-1.5 tabular-nums">{items.length}</span>
        </>
      }
    >
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('home.overview.attention.empty', 'Nothing is waiting on you.')}
        </p>
      ) : (
        <ul className="scrollbar-sleek flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {items.map((item) => (
            <li key={item.id} className="flex">
              <AttentionChip item={item} actions={actions} />
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  )
}
