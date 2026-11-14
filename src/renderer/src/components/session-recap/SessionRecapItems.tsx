import {
  CircleAlert,
  CircleDot,
  Check,
  ExternalLink,
  FileText,
  GitPullRequest,
  Link2,
  Undo2,
  X
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  RecapItem,
  RecapItemMark,
  RecapReference,
  RecapWorkState
} from '../../../../shared/session-recap/session-recap-types'

export type RecapJump = (messageId: string) => void

/** An item's words; with a message behind it, a button that brings that message into view. */
export function RecapItemText({
  item,
  onJump,
  className
}: {
  item: Pick<RecapItem, 'id' | 'text' | 'messageId'>
  onJump: RecapJump
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  const { messageId } = item
  if (messageId === null) {
    return (
      <span className={cn('min-w-0 flex-1 text-xs leading-5 break-words', className)}>
        {item.text}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-recap-jump={messageId}
      title={t('seal.sessionRecap.jump', 'Show in the conversation')}
      onClick={() => onJump(messageId)}
      className={cn(
        'min-w-0 flex-1 cursor-pointer rounded-sm text-left text-xs leading-5 break-words outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      {item.text}
    </button>
  )
}

const ROW = 'group/recap flex items-start gap-2 px-3 py-1'
const ROW_ACTION =
  'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none group-hover/recap:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring'

/** A plain line of the recap: something asked, decided or left unaddressed. */
export function RecapLineRow({
  item,
  kind,
  onJump
}: {
  item: RecapItem
  /** Set where items of several kinds share a list. */
  kind?: string
  onJump: RecapJump
}): React.JSX.Element {
  return (
    <li data-recap-item={item.id} className={ROW}>
      {kind ? (
        <span className="flex h-5 shrink-0 items-center">
          <Badge variant="referenceLabel">{kind}</Badge>
        </span>
      ) : null}
      <RecapItemText item={item} onJump={onJump} />
    </li>
  )
}

const WORK_ICONS: Record<RecapWorkState, typeof Check> = {
  done: Check,
  'in-progress': CircleDot,
  blocked: CircleAlert
}

/** Something the agent did, is doing, or is stuck on. */
export function RecapWorkRow({
  item,
  label,
  onJump
}: {
  item: RecapItem
  label: string
  onJump: RecapJump
}): React.JSX.Element {
  const state = item.state ?? 'done'
  const Icon = WORK_ICONS[state]
  return (
    <li data-recap-item={item.id} data-recap-work={state} className={ROW}>
      <Icon
        aria-label={label}
        className={cn(
          'mt-0.5 size-3.5 shrink-0',
          state === 'in-progress' && 'text-agent-working',
          state === 'blocked' && 'text-agent-question-text',
          state === 'done' && 'text-muted-foreground'
        )}
      />
      <RecapItemText
        item={item}
        onJump={onJump}
        className={state === 'done' ? 'text-muted-foreground' : 'font-medium'}
      />
    </li>
  )
}

/** A question or an action item for the user: tick it when handled, dismiss it when it does not matter. */
export function RecapTickRow({
  item,
  mark,
  isNew,
  onMark,
  onJump
}: {
  item: RecapItem
  mark: RecapItemMark | undefined
  /** It came up since the user last looked. */
  isNew?: boolean
  onMark: (itemId: string, mark: RecapItemMark | null) => void
  onJump: RecapJump
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <li data-recap-item={item.id} data-recap-mark={mark ?? 'open'} className={ROW}>
      <span className="flex h-5 shrink-0 items-center">
        <Checkbox
          checked={mark === 'done'}
          aria-label={t('seal.sessionRecap.tick', 'Done: {{item}}', { item: item.text })}
          onCheckedChange={(checked) => onMark(item.id, checked === true ? 'done' : null)}
        />
      </span>
      <RecapItemText
        item={item}
        onJump={onJump}
        className={mark ? 'text-muted-foreground line-through' : undefined}
      />
      {isNew && mark === undefined ? (
        <span className="flex h-5 shrink-0 items-center">
          <Badge variant="referenceLabel">{t('seal.sessionRecap.new', 'New')}</Badge>
        </span>
      ) : null}
      {mark === 'dismissed' ? (
        <button
          type="button"
          data-recap-restore={item.id}
          aria-label={t('seal.sessionRecap.restore', 'Bring back: {{item}}', { item: item.text })}
          title={t('seal.sessionRecap.restoreTitle', 'Bring back')}
          onClick={() => onMark(item.id, null)}
          className={ROW_ACTION}
        >
          <Undo2 className="size-3.5" />
        </button>
      ) : mark === undefined ? (
        <button
          type="button"
          data-recap-dismiss={item.id}
          aria-label={t('seal.sessionRecap.dismiss', 'Dismiss: {{item}}', { item: item.text })}
          title={t('seal.sessionRecap.dismissTitle', 'Dismiss')}
          onClick={() => onMark(item.id, 'dismissed')}
          className={ROW_ACTION}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </li>
  )
}

const REFERENCE_ICONS = { file: FileText, pr: GitPullRequest, link: Link2 } as const

/** A file the agent changed, or a pull request or link that came up. */
export function RecapReferenceRow({
  reference,
  onJump,
  onOpenLink
}: {
  reference: RecapReference
  onJump: RecapJump
  onOpenLink: (url: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const Icon = REFERENCE_ICONS[reference.kind]
  return (
    <li data-recap-reference={reference.kind} className={ROW}>
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <RecapItemText
        item={{ id: reference.target, text: reference.label, messageId: reference.messageId }}
        onJump={onJump}
        className={cn('break-all', reference.kind === 'file' && 'font-mono')}
      />
      {reference.kind === 'file' ? null : (
        <button
          type="button"
          aria-label={t('seal.sessionRecap.openLink', 'Open {{label}} in the browser', {
            label: reference.label
          })}
          title={t('seal.sessionRecap.openLinkTitle', 'Open in the browser')}
          onClick={() => onOpenLink(reference.target)}
          className={ROW_ACTION}
        >
          <ExternalLink className="size-3.5" />
        </button>
      )}
    </li>
  )
}
