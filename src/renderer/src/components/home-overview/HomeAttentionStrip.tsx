import { Gauge, ServerCrash } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { useTranslate } from '@/i18n/use-translate'
import type { HomeAttentionItem } from './home-overview-derivations'
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
  switch (item.kind) {
    case 'session': {
      const { session } = item
      const label = homeSessionStateLabel(session.state, t)
      return (
        <button type="button" className={CHIP_CLASS} onClick={() => actions.openSession(session)}>
          <AgentStateDot state={homeSessionDotState(session.state)} title={null} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{session.title}</span>
            <span className="block truncate text-2xs text-muted-foreground">
              {label} · {session.machineLabel}
            </span>
          </span>
        </button>
      )
    }
    case 'machine':
      return (
        <button type="button" className={CHIP_CLASS} onClick={actions.openMachinesSettings}>
          <ServerCrash className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{item.machine.label}</span>
            <span className="block truncate text-2xs text-muted-foreground">
              {item.machine.error ?? t('home.overview.attention.machineError', 'Connection failed')}
            </span>
          </span>
        </button>
      )
    case 'account':
      return (
        <button type="button" className={CHIP_CLASS} onClick={actions.openAccountsSettings}>
          <Gauge className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{item.account.label}</span>
            <span className="block truncate text-2xs text-muted-foreground tabular-nums">
              {t('home.overview.attention.accountUsage', '{{provider}} at {{percent}}% of limit', {
                provider: item.account.providerLabel,
                percent: Math.round(item.usedPercent)
              })}
            </span>
          </span>
        </button>
      )
  }
}

export function HomeAttentionStrip({
  items,
  actions
}: {
  items: readonly HomeAttentionItem[]
  actions: HomeOverviewActions
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <section
      aria-label={t('home.overview.attention.title', 'Needs attention')}
      className="flex min-h-12 items-center gap-3"
    >
      <h2 className="shrink-0 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        {t('home.overview.attention.title', 'Needs attention')}
        <span className="ml-1.5 tabular-nums">{items.length}</span>
      </h2>
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
    </section>
  )
}
