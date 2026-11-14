import { ListChecks, MessageCircleQuestion } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { LiveSessionRecapBrief } from '../../../../shared/session-recap/session-recap-types'

/** On a session's row: how many questions and action items still wait on the user. Nothing at zero. */
export function SessionRecapBadge({
  brief,
  className
}: {
  brief: LiveSessionRecapBrief | undefined
  className?: string
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!brief || brief.questions + brief.actions === 0) {
    return null
  }
  const label = [
    brief.questions > 0
      ? t('seal.sessionRecap.badgeQuestions', 'Questions for you: {{count}}', {
          count: brief.questions
        })
      : null,
    brief.actions > 0
      ? t('seal.sessionRecap.badgeActions', 'Your action items: {{count}}', {
          count: brief.actions
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
      {brief.questions > 0 ? (
        <span className="flex items-center gap-0.5">
          <MessageCircleQuestion className="size-3" aria-hidden />
          {brief.questions}
        </span>
      ) : null}
      {brief.actions > 0 ? (
        <span className="flex items-center gap-0.5">
          <ListChecks className="size-3" aria-hidden />
          {brief.actions}
        </span>
      ) : null}
    </span>
  )
}
