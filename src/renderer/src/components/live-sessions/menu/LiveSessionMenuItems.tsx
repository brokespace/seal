import { Fragment } from 'react'
import {
  ArrowRightLeft,
  Bot,
  Brain,
  Check,
  Columns2,
  Copy,
  EyeOff,
  FolderOpen,
  FolderSearch,
  Hand,
  ListTodo,
  LogIn,
  MessageSquare,
  PanelTop,
  Pencil,
  Pin,
  PinOff,
  Server,
  ShieldQuestion,
  Square,
  SquareArrowOutUpRight,
  TerminalSquare,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionLinks } from '../links/use-live-session-links'
import { canTakeOver } from '../take-over/live-session-take-over'
import { liveSessionSwapTargets, useLocalSealAccounts } from './live-session-accounts'
import {
  liveSessionMenuItems,
  runLiveSessionMenuItem,
  type LiveSessionMenuContext,
  type LiveSessionMenuEffects,
  type LiveSessionMenuItemId
} from './live-session-menu'
import { liveSessionMenuEffects, liveSessionResumeCommand } from './live-session-menu-effects'

/** The same items render in a right-click menu and in a button's dropdown. */
export type LiveSessionMenuKit = {
  Item: typeof ContextMenuItem | typeof DropdownMenuItem
  Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator
  Sub: typeof ContextMenuSub | typeof DropdownMenuSub
  SubTrigger: typeof ContextMenuSubTrigger | typeof DropdownMenuSubTrigger
  SubContent: typeof ContextMenuSubContent | typeof DropdownMenuSubContent
}

export const CONTEXT_MENU_KIT: LiveSessionMenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent
}

export const DROPDOWN_MENU_KIT: LiveSessionMenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent
}

const ICONS: Record<LiveSessionMenuItemId, LucideIcon> = {
  open: SquareArrowOutUpRight,
  'open-new-tab': PanelTop,
  'open-split': Columns2,
  'send-message': MessageSquare,
  'answer-permission': ShieldQuestion,
  'view-subagents': Bot,
  'view-tasks': ListTodo,
  'view-reasoning': Brain,
  rename: Pencil,
  pin: Pin,
  'copy-session-id': Copy,
  'copy-resume-command': TerminalSquare,
  'swap-account': ArrowRightLeft,
  'take-over': LogIn,
  'open-worktree': FolderOpen,
  'open-machine': Server,
  'reveal-transcript': FolderSearch,
  stop: Square,
  'stop-and-remove': Hand,
  remove: EyeOff,
  'delete-with-transcripts': Trash2
}

export function liveSessionMenuLabel(
  id: LiveSessionMenuItemId,
  session: Pick<LiveSession, 'pinned'>,
  t: Translate
): string {
  switch (id) {
    case 'open':
      return t('auto.components.live-sessions.menu.open', 'Open')
    case 'open-new-tab':
      return t('auto.components.live-sessions.menu.openTab', 'Open in new tab')
    case 'open-split':
      return t('auto.components.live-sessions.menu.openSplit', 'Open in split')
    case 'send-message':
      return t('auto.components.live-sessions.menu.send', 'Send message…')
    case 'answer-permission':
      return t('auto.components.live-sessions.menu.answer', 'Answer pending permission')
    case 'view-subagents':
      return t('auto.components.live-sessions.menu.subagents', 'View subagents')
    case 'view-tasks':
      return t('auto.components.live-sessions.menu.tasks', 'View tasks')
    case 'view-reasoning':
      return t('auto.components.live-sessions.menu.reasoning', 'View reasoning')
    case 'rename':
      return t('auto.components.live-sessions.menu.rename', 'Rename…')
    case 'pin':
      return session.pinned
        ? t('auto.components.live-sessions.menu.unpin', 'Unpin')
        : t('auto.components.live-sessions.menu.pin', 'Pin to top')
    case 'copy-session-id':
      return t('auto.components.live-sessions.menu.copyId', 'Copy session id')
    case 'copy-resume-command':
      return t('auto.components.live-sessions.menu.copyResume', 'Copy resume command')
    case 'swap-account':
      return t('auto.components.live-sessions.menu.swap', 'Swap account')
    case 'take-over':
      return t('auto.components.live-sessions.menu.takeOver', 'Take over in a Seal pane')
    case 'open-worktree':
      return t('auto.components.live-sessions.menu.openWorktree', 'Open project workspace')
    case 'open-machine':
      return t('auto.components.live-sessions.menu.openMachine', 'Open machine')
    case 'reveal-transcript':
      return t('auto.components.live-sessions.menu.reveal', 'Reveal transcript file')
    case 'stop':
      return t('auto.components.live-sessions.menu.stop', 'Stop…')
    case 'stop-and-remove':
      return t('auto.components.live-sessions.menu.stopRemove', 'Stop and remove…')
    case 'remove':
      return t('auto.components.live-sessions.menu.remove', 'Remove from Seal…')
    case 'delete-with-transcripts':
      return t('auto.components.live-sessions.menu.delete', 'Delete with transcripts…')
  }
}

export function useLiveSessionMenuContext(session: LiveSession): LiveSessionMenuContext {
  const { links } = useLiveSessionLinks()
  const accounts = useLocalSealAccounts()
  return {
    worktreeId: links.get(session.id)?.worktreeId ?? null,
    swapAccounts: liveSessionSwapTargets(session, accounts),
    canTakeOver: canTakeOver(session)
  }
}

/** The items for a known context; `LiveSessionMenuItems` works the context out. */
export function LiveSessionMenuItemsView({
  session,
  context,
  kit,
  effects
}: {
  session: LiveSession
  context: LiveSessionMenuContext
  kit: LiveSessionMenuKit
  effects: LiveSessionMenuEffects
}): React.JSX.Element {
  const t = useTranslate()
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit
  const run = (id: LiveSessionMenuItemId, accountKey?: string) =>
    runLiveSessionMenuItem(id, session, context, effects, {
      resumeCommand: liveSessionResumeCommand(session),
      accountKey
    })
  return (
    <>
      {liveSessionMenuItems(session, context).map((item) => {
        const Icon = item.id === 'pin' && session.pinned ? PinOff : ICONS[item.id]
        const label = liveSessionMenuLabel(item.id, session, t)
        return (
          <Fragment key={item.id}>
            {item.startsGroup ? <Separator /> : null}
            {item.id === 'swap-account' && !item.disabled ? (
              <Sub>
                <SubTrigger data-live-session-menu-item={item.id}>
                  <Icon className="size-3.5" />
                  {label}
                </SubTrigger>
                <SubContent>
                  {context.swapAccounts.map((target) => (
                    <Item
                      key={target.key}
                      data-live-session-account={target.key}
                      disabled={target.current}
                      onSelect={() => run('swap-account', target.key)}
                    >
                      {target.current ? (
                        <Check className="size-3.5" />
                      ) : (
                        <span className="size-3.5" />
                      )}
                      {target.label}
                    </Item>
                  ))}
                </SubContent>
              </Sub>
            ) : (
              <Item
                data-live-session-menu-item={item.id}
                disabled={item.disabled}
                variant={item.destructive ? 'destructive' : 'default'}
                onSelect={() => run(item.id)}
              >
                <Icon className="size-3.5" />
                {label}
              </Item>
            )}
          </Fragment>
        )
      })}
    </>
  )
}

/** Every action a session supports, for whichever menu surface `kit` draws. */
export function LiveSessionMenuItems({
  session,
  kit
}: {
  session: LiveSession
  kit: LiveSessionMenuKit
}): React.JSX.Element {
  const context = useLiveSessionMenuContext(session)
  return (
    <LiveSessionMenuItemsView
      session={session}
      context={context}
      kit={kit}
      effects={liveSessionMenuEffects}
    />
  )
}
