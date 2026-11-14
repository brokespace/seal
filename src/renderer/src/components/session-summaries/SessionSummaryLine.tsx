import { Sparkles } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { SessionSummaryView } from '../../../../shared/session-summaries/session-summary-contracts'

/**
 * One muted line under a session's title: what the agent did or needs. The line keeps one height
 * while the sentence is being written, so the row never jumps when it arrives.
 */
export function SessionSummaryLine({
  summary,
  className,
  tooltip = true
}: {
  summary: SessionSummaryView
  className?: string
  /** Off where the row's own hover preview already shows the whole sentence. */
  tooltip?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  if (summary.text === null) {
    return summary.pending ? (
      <span
        role="status"
        aria-label={t('seal.sessionSummaries.pending', 'Summarizing…')}
        className={cn('flex h-4 items-center gap-1', className)}
      >
        <Sparkles className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />
        <span className="h-2 w-2/5 animate-pulse rounded-sm bg-muted" />
      </span>
    ) : null
  }
  const line = (
    <span
      data-session-summary=""
      className={cn('flex h-4 min-w-0 items-center gap-1 text-xs text-muted-foreground', className)}
    >
      <Sparkles className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
      <span className="min-w-0 truncate">{summary.text}</span>
    </span>
  )
  if (!tooltip) {
    return line
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{line}</TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-80">
        {summary.text}
        <span className="mt-0.5 block text-background/60">
          {t('seal.sessionSummaries.tooltipSource', 'AI summary of the last message')}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
