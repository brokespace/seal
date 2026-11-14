import { useState } from 'react'
import { ChevronRight, ListChecks, MessageCircleQuestion, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import {
  LiveSessionPanelEmpty,
  LiveSessionPanelSectionTitle,
  LiveSessionSidePanel
} from '@/components/live-sessions/workspace/LiveSessionSidePanel'
import type {
  RecapItem,
  RecapItemMark,
  SessionRecap,
  SessionRecapView
} from '../../../../shared/session-recap/session-recap-types'
import {
  recapHasContent,
  recapItemIsNew,
  recapItemsByMark,
  recapNewsSinceLastLook,
  recapWorkByState
} from '../../../../shared/session-recap/session-recap-view'
import { recapItemKindLabel, recapStateNote, recapUpdatedLabel } from './session-recap-copy'
import {
  RecapLineRow,
  RecapReferenceRow,
  RecapTickRow,
  RecapWorkRow,
  type RecapJump
} from './SessionRecapItems'

/** How many of the user's own messages show before "earlier" folds the rest away. */
const ASKED_SHOWN = 6

export type SessionRecapPanelProps = {
  /** Null until the host has answered once. */
  view: SessionRecapView | null
  refreshing: boolean
  now: number
  onRefresh: () => void
  onMark: (itemId: string, mark: RecapItemMark | null) => void
  onJump: RecapJump
  onOpenLink: (url: string) => void
  /** Where a Cloudflare account is set up; shown when recaps cannot run. */
  onOpenSettings?: () => void
  onClose: () => void
}

function Section({
  name,
  title,
  count,
  icon,
  children
}: {
  name: string
  title: string
  count?: number
  icon?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section data-recap-section={name}>
      <LiveSessionPanelSectionTitle>
        {icon}
        <span>{title}</span>
        {count ? <span className="font-normal tabular-nums opacity-70">{count}</span> : null}
      </LiveSessionPanelSectionTitle>
      {children}
    </section>
  )
}

function Folded({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className="flex cursor-pointer items-center gap-1 rounded-sm px-3 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {label}
      </button>
      {open ? children : null}
    </>
  )
}

/** Open questions or action items, then the ones already ticked or dismissed, folded away. */
function TickSection({
  name,
  title,
  icon,
  items,
  view,
  onMark,
  onJump
}: {
  name: string
  title: string
  icon: React.ReactNode
  items: readonly RecapItem[]
  view: SessionRecapView
  onMark: SessionRecapPanelProps['onMark']
  onJump: RecapJump
}): React.JSX.Element | null {
  const t = useTranslate()
  const { marks } = view
  const { open, settled } = recapItemsByMark(items, marks)
  if (items.length === 0) {
    return null
  }
  const row = (item: RecapItem): React.JSX.Element => (
    <RecapTickRow
      key={item.id}
      item={item}
      mark={marks[item.id]}
      isNew={recapItemIsNew(view, item)}
      onMark={onMark}
      onJump={onJump}
    />
  )
  return (
    <Section name={name} title={title} icon={icon} count={open.length}>
      {open.length > 0 ? (
        <ul>{open.map(row)}</ul>
      ) : (
        <LiveSessionPanelEmpty>
          {t('seal.sessionRecap.allSettled', 'Nothing open.')}
        </LiveSessionPanelEmpty>
      )}
      {settled.length > 0 ? (
        <Folded
          label={t('seal.sessionRecap.settled', '{{count}} done or dismissed', {
            count: settled.length
          })}
        >
          <ul>{settled.map(row)}</ul>
        </Folded>
      ) : null}
    </Section>
  )
}

function RecapBody({
  recap,
  view,
  now,
  onMark,
  onJump,
  onOpenLink
}: Pick<SessionRecapPanelProps, 'now' | 'onMark' | 'onJump' | 'onOpenLink'> & {
  recap: SessionRecap
  view: SessionRecapView
}): React.JSX.Element {
  const t = useTranslate()
  const news = recapNewsSinceLastLook(view)
  const work = recapWorkByState(recap.did)
  const earlierAsked = recap.asked.slice(0, Math.max(0, recap.asked.length - ASKED_SHOWN))
  const recentAsked = recap.asked.slice(earlierAsked.length)
  const line = (item: RecapItem): React.JSX.Element => (
    <RecapLineRow key={item.id} item={item} onJump={onJump} />
  )
  return (
    <>
      {recap.goal ? (
        <Section name="goal" title={t('seal.sessionRecap.goal', 'Goal')}>
          <p className="px-3 py-1 text-xs leading-5 break-words">{recap.goal}</p>
        </Section>
      ) : null}
      {recap.standing ? (
        <Section name="standing" title={t('seal.sessionRecap.standing', 'Where it stands')}>
          <p className="px-3 py-1 text-xs leading-5 break-words">{recap.standing}</p>
        </Section>
      ) : null}
      {news.length > 0 && view.since !== null ? (
        <Section
          name="news"
          title={t('seal.sessionRecap.news', 'Since you last looked')}
          count={news.length}
        >
          <p className="px-3 pb-1 text-2xs text-muted-foreground">
            {t('seal.sessionRecap.newsSince', 'Your last visit was {{age}} ago.', {
              age: formatShortTimeAgo(view.since, now)
            })}
          </p>
          <ul>
            {news.map(({ section, item }) =>
              section === 'did' ? (
                <RecapWorkRow
                  key={item.id}
                  item={item}
                  label={recapItemKindLabel(section, item, t)}
                  onJump={onJump}
                />
              ) : (
                <RecapLineRow
                  key={item.id}
                  item={item}
                  kind={recapItemKindLabel(section, item, t)}
                  onJump={onJump}
                />
              )
            )}
          </ul>
        </Section>
      ) : null}
      <TickSection
        name="questions"
        title={t('seal.sessionRecap.questions', 'Questions for you')}
        icon={<MessageCircleQuestion className="size-3" aria-hidden />}
        items={recap.questions}
        view={view}
        onMark={onMark}
        onJump={onJump}
      />
      <TickSection
        name="actions"
        title={t('seal.sessionRecap.actions', 'Your action items')}
        icon={<ListChecks className="size-3" aria-hidden />}
        items={recap.actions}
        view={view}
        onMark={onMark}
        onJump={onJump}
      />
      {recap.ignored.length > 0 ? (
        <Section
          name="ignored"
          title={t('seal.sessionRecap.ignored', 'Asked but not addressed')}
          count={recap.ignored.length}
        >
          <ul>{recap.ignored.map(line)}</ul>
        </Section>
      ) : null}
      {recap.asked.length > 0 ? (
        <Section
          name="asked"
          title={t('seal.sessionRecap.asked', 'What you asked')}
          count={recap.asked.length}
        >
          {earlierAsked.length > 0 ? (
            <Folded
              label={t('seal.sessionRecap.earlier', '{{count}} earlier', {
                count: earlierAsked.length
              })}
            >
              <ul>{earlierAsked.map(line)}</ul>
            </Folded>
          ) : null}
          <ul>{recentAsked.map(line)}</ul>
        </Section>
      ) : null}
      {work.length > 0 ? (
        <Section name="did" title={t('seal.sessionRecap.did', 'What the agent did')}>
          <ul>
            {work.flatMap((group) =>
              group.items.map((item) => (
                <RecapWorkRow
                  key={item.id}
                  item={item}
                  label={recapItemKindLabel('did', item, t)}
                  onJump={onJump}
                />
              ))
            )}
          </ul>
        </Section>
      ) : null}
      {recap.decisions.length > 0 ? (
        <Section name="decisions" title={t('seal.sessionRecap.decisions', 'Decisions')}>
          <ul>{recap.decisions.map(line)}</ul>
        </Section>
      ) : null}
      {recap.references.length > 0 ? (
        <Section
          name="references"
          title={t('seal.sessionRecap.references', 'Files, PRs and links')}
        >
          <ul>
            {recap.references.map((reference) => (
              <RecapReferenceRow
                key={`${reference.kind}:${reference.target}`}
                reference={reference}
                onJump={onJump}
                onOpenLink={onOpenLink}
              />
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  )
}

function Writing({ label }: { label: string }): React.JSX.Element {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2 px-3 pt-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <span className="h-2 w-4/5 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
      <span className="h-2 w-3/5 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
      <span className="h-2 w-2/3 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
    </div>
  )
}

/** Beside a session's chat: what it is for, where it stands and what still waits on the user. */
export function SessionRecapPanel(props: SessionRecapPanelProps): React.JSX.Element {
  const t = useTranslate()
  const { view, now } = props
  const recap = view?.recap ?? null
  const updating = props.refreshing || view?.state === 'updating'
  const note = view ? recapStateNote(view, t) : null
  const writing = t('seal.sessionRecap.writing', 'Reading the session\u2026')
  return (
    <LiveSessionSidePanel
      panel="recap"
      title={t('seal.sessionRecap.title', 'Recap')}
      onClose={props.onClose}
      footer={
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
          <p data-recap-updated className="min-w-0 flex-1 text-2xs text-muted-foreground">
            {updating
              ? t('seal.sessionRecap.updating', 'Updating\u2026')
              : recap
                ? [
                    recapUpdatedLabel(recap.updatedAt, now, t),
                    recap.coveredFrom > 0
                      ? t('seal.sessionRecap.partial', 'recent history only')
                      : null
                  ]
                    .filter(Boolean)
                    .join(' \u00b7 ')
                : null}
          </p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-recap-refresh
            disabled={
              updating || view === null || view.state === 'unavailable' || view.state === 'paused'
            }
            onClick={props.onRefresh}
          >
            <RefreshCw
              className={updating ? 'animate-spin motion-reduce:animate-none' : undefined}
            />
            {t('seal.sessionRecap.refresh', 'Refresh recap')}
          </Button>
        </footer>
      }
    >
      {note ? (
        <p
          data-recap-note={view?.state}
          className="border-b border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground"
        >
          {note}
          {view?.state === 'unavailable' && props.onOpenSettings ? (
            <>
              {' '}
              <button
                type="button"
                data-recap-open-settings=""
                onClick={props.onOpenSettings}
                className="cursor-pointer rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('seal.sessionRecap.openSettings', 'Open settings')}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {view !== null && recapHasContent(recap) ? (
        <RecapBody
          recap={recap}
          view={view}
          now={now}
          onMark={props.onMark}
          onJump={props.onJump}
          onOpenLink={props.onOpenLink}
        />
      ) : view === null || updating ? (
        <Writing label={writing} />
      ) : null}
    </LiveSessionSidePanel>
  )
}
