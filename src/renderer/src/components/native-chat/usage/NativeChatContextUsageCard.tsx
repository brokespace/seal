import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { recomputeOn } from '@/lib/recompute-on'
import { formatTimeAgo } from '../../status-bar/tooltip'
import {
  isContextUsageMeasured,
  type NativeChatContextUsageReadout,
  type NativeChatContextUsageState
} from '../../../../../shared/native-chat/native-chat-context-usage-state'
import {
  formatContextTokenCount,
  keyContextUsageRows
} from '../../../../../shared/native-chat/native-chat-context-usage-summary'
import type { NativeChatContextUsageRingInput } from './native-chat-context-usage-ring-input'

const STATE_TONE: Partial<Record<NativeChatContextUsageState, string>> = {
  near: 'text-status-warning-text',
  critical: 'text-destructive'
}

/** What the ring says beside itself; a state that needs no words has none. */
export function contextUsageStateText(
  state: NativeChatContextUsageState,
  t: Translate
): string | null {
  switch (state) {
    case 'near':
      return t('seal.contextIndicator.compactsSoon', 'Compacts soon')
    case 'critical':
      return t('seal.contextIndicator.almostFull', 'Context almost full')
    case 'compacting':
      return t('seal.contextIndicator.compacting', 'Compacting…')
    case 'compacted':
      return t('seal.contextIndicator.compacted', 'Compacted')
    case 'unknown':
    case 'normal':
      return null
  }
}

function compactionHistory(count: number, ago: string | null, t: Translate): string | null {
  if (count > 0 && ago !== null) {
    return t(
      'seal.contextIndicator.compactedCountLast',
      'Compacted {{count}} times, last {{ago}}',
      {
        count,
        ago,
        defaultValue_one: 'Compacted {{count}} time, last {{ago}}'
      }
    )
  }
  if (count > 0) {
    return t('seal.contextIndicator.compactedCount', 'Compacted {{count}} times', {
      count,
      defaultValue_one: 'Compacted {{count}} time'
    })
  }
  return ago === null
    ? null
    : t('seal.contextIndicator.lastCompacted', 'Last compacted {{ago}}', { ago })
}

/** Deferred rows sit outside the window, so they show tokens rather than a share of it. */
function ContextUsageRowList({
  rows,
  className
}: {
  rows: ReturnType<typeof keyContextUsageRows>
  className: string
}): React.JSX.Element {
  return (
    <ul className={cn('space-y-1 text-xs', className)}>
      {rows.map(({ key, row }) => (
        <li key={key} className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              'min-w-0 truncate',
              row.deferred ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {row.name}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {row.deferred ? formatContextTokenCount(row.tokens) : `${row.percentage}%`}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The ring's popover body: the numbers, how far the next compaction is, and the breakdown. */
export function NativeChatContextUsageCard({
  usage,
  readout,
  label,
  now,
  note
}: {
  usage: NativeChatContextUsageRingInput
  readout: NativeChatContextUsageReadout
  /** The ring's accessible label, which also names the progress bar. */
  label: string
  now: number
  /** Replaces the estimate's own footnote: the surface explains its numbers itself. */
  note?: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const { state, filled, used, window, compactsAt, left } = readout
  const measured = isContextUsageMeasured(usage)
  const stateText = contextUsageStateText(state, t)
  const amounts = { used, window, percent: String(usage.percentage) }
  const lastCompactedAt = usage.lastCompactedAt
  const history = compactionHistory(
    usage.compactions ?? 0,
    // formatTimeAgo reads Date.now(); recomputeOn ties React Compiler's cache to the clock tick.
    lastCompactedAt === undefined
      ? null
      : recomputeOn([now], () => formatTimeAgo(lastCompactedAt, t)),
    t
  )
  const rows = keyContextUsageRows(usage.rows)
  const counted = rows.filter(({ row }) => !row.deferred)
  const deferred = rows.filter(({ row }) => row.deferred)
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {t('components.native-chat.contextUsage.title', 'Context')}
        </p>
        {stateText !== null ? (
          <p className={cn('text-xs', STATE_TONE[state] ?? 'text-muted-foreground')}>{stateText}</p>
        ) : null}
      </div>
      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
        {measured ? (
          <>
            <p className="tabular-nums">
              {usage.estimated
                ? t(
                    'seal.contextIndicator.usageAbout',
                    'About {{used}} of {{window}} tokens ({{percent}}%)',
                    amounts
                  )
                : t(
                    'seal.contextIndicator.usage',
                    '{{used}} of {{window}} tokens ({{percent}}%)',
                    amounts
                  )}
            </p>
            <Progress value={filled} aria-label={label} className="my-2 h-1.5" />
            {usage.model ? <p className="truncate">{usage.model}</p> : null}
          </>
        ) : (
          <p>{t('seal.contextIndicator.empty', 'Context usage appears after the first reply.')}</p>
        )}
        {compactsAt !== undefined && left !== undefined ? (
          <p className={cn('tabular-nums', STATE_TONE[state], STATE_TONE[state] && 'font-medium')}>
            {t(
              'seal.contextIndicator.compactsAt',
              'Compacts automatically at {{threshold}}: {{left}} left',
              { threshold: compactsAt, left }
            )}
          </p>
        ) : null}
        {history !== null ? <p>{history}</p> : null}
      </div>
      {usage.onCompact && measured ? (
        <Button
          type="button"
          size="sm"
          variant={state === 'critical' ? 'default' : 'outline'}
          className="mt-3 w-full"
          disabled={usage.compactDisabled === true || usage.compacting === true}
          data-native-chat-context-compact=""
          // As the ring: a press must not pull focus out of the composer.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => usage.onCompact?.()}
        >
          {t('seal.contextIndicator.compactNow', 'Compact now')}
        </Button>
      ) : null}
      {counted.length > 0 ? <ContextUsageRowList rows={counted} className="mt-3" /> : null}
      {deferred.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-2xs text-muted-foreground">
            {t(
              'components.native-chat.contextUsage.deferredNote',
              'Loaded on demand. Not counted in the used total.'
            )}
          </p>
          <ContextUsageRowList rows={deferred} className="mt-2" />
        </div>
      ) : null}
      {usage.estimated && !note ? (
        <p className="mt-3 text-2xs text-muted-foreground">
          {t('components.native-chat.contextUsage.estimated', 'Estimated from the last response.')}
        </p>
      ) : null}
      {note ? <div className="mt-3 text-2xs text-muted-foreground">{note}</div> : null}
    </div>
  )
}
