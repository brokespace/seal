import {
  ListChecks,
  MessageCircleQuestion,
  NotebookText,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { SessionRecapView } from '../../../../shared/session-recap/session-recap-types'
import {
  recapHeadline,
  recapItemsByMark,
  recapNewCount
} from '../../../../shared/session-recap/session-recap-view'
import { recapUpdatedLabel } from './session-recap-copy'

function Count({
  count,
  label,
  children
}: {
  count: number
  label: string
  children: React.ReactNode
}): React.JSX.Element | null {
  if (count === 0) {
    return null
  }
  return (
    <span
      title={label}
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 text-2xs text-agent-question-text tabular-nums"
    >
      {children}
      {count}
    </span>
  )
}

/**
 * The recap folded to one line under a session's header: where things stand and what waits on the
 * user. Pressing it opens the whole recap beside the chat.
 */
export function SessionRecapBar({
  view,
  open,
  now,
  onToggle
}: {
  view: SessionRecapView | null
  /** The recap panel is showing. */
  open: boolean
  now: number
  onToggle: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const recap = view?.recap ?? null
  const headline = recapHeadline(recap)
  const writing = view?.state === 'updating'
  if (view === null || (headline === null && !writing)) {
    return null
  }
  const questions = recap ? recapItemsByMark(recap.questions, view.marks).open.length : 0
  const actions = recap ? recapItemsByMark(recap.actions, view.marks).open.length : 0
  const news = recapNewCount(view)
  const PanelIcon = open ? PanelRightClose : PanelRightOpen
  return (
    <button
      type="button"
      data-session-recap-bar=""
      aria-expanded={open}
      aria-label={t('seal.sessionRecap.barLabel', 'Recap')}
      onClick={onToggle}
      className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <NotebookText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {headline ? (
        <span className="min-w-0 flex-1 truncate text-xs">{headline}</span>
      ) : (
        <span role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">
          {t('seal.sessionRecap.writing', 'Reading the session\u2026')}
        </span>
      )}
      {news > 0 ? (
        <span className="shrink-0 text-2xs text-muted-foreground">
          {t('seal.sessionRecap.barNews', '{{count}} new', { count: news })}
        </span>
      ) : null}
      <Count
        count={questions}
        label={t('seal.sessionRecap.badgeQuestions', 'Questions for you: {{count}}', {
          count: questions
        })}
      >
        <MessageCircleQuestion className="size-3" aria-hidden />
      </Count>
      <Count
        count={actions}
        label={t('seal.sessionRecap.badgeActions', 'Your action items: {{count}}', {
          count: actions
        })}
      >
        <ListChecks className="size-3" aria-hidden />
      </Count>
      {recap ? (
        <span className="hidden shrink-0 text-2xs text-muted-foreground @2xl:inline">
          {writing
            ? t('seal.sessionRecap.updating', 'Updating\u2026')
            : recapUpdatedLabel(recap.updatedAt, now, t)}
        </span>
      ) : null}
      <PanelIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}
