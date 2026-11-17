import { ListChecks, ListX, MessageCircleQuestion } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { LiveSessionRecapBrief } from '../../../../shared/session-recap/session-recap-types'
import { recapAttention } from '../../../../shared/session-recap/session-recap-view'

/** On a session's row: the questions, action items and unaddressed requests that wait on the user. Nothing at zero. */
export function SessionRecapBadge({
  brief,
  className
}: {
  brief: LiveSessionRecapBrief | undefined
  className?: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const { questions, actions, notAddressed, total } = recapAttention(brief)
  if (total === 0) {
    return null
  }
  const label = [
    questions > 0
      ? t('seal.sessionRecap.badgeQuestions', 'Questions for you: {{count}}', { count: questions })
      : null,
    actions > 0
      ? t('seal.sessionRecap.badgeActions', 'Your action items: {{count}}', { count: actions })
      : null,
    notAddressed > 0
      ? t('seal.sessionRecap.badgeNotAddressed', 'Requests not addressed: {{count}}', {
          count: notAddressed
        })
      : null
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <span
      data-session-recap-badge=""
      title={label}
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center gap-1 text-agent-question-text tabular-nums',
        className
      )}
    >
      {questions > 0 ? (
        <span className="flex items-center gap-0.5">
          <MessageCircleQuestion className="size-3" aria-hidden />
          {questions}
        </span>
      ) : null}
      {actions > 0 ? (
        <span className="flex items-center gap-0.5">
          <ListChecks className="size-3" aria-hidden />
          {actions}
        </span>
      ) : null}
      {notAddressed > 0 ? (
        <span className="flex items-center gap-0.5">
          <ListX className="size-3" aria-hidden />
          {notAddressed}
        </span>
      ) : null}
    </span>
  )
}
