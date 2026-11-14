import type {
  LiveRemoveRequest,
  LiveSession
} from '../../../../../shared/live-sessions/live-session-types'
import type {
  LiveSessionFocusTarget,
  LiveSessionOpenMode
} from '../workspace/live-session-tabs-store'

export const LIVE_SESSION_MENU_ITEM_IDS = [
  'open',
  'open-new-tab',
  'open-split',
  'send-message',
  'answer-permission',
  'view-subagents',
  'view-tasks',
  'view-reasoning',
  'rename',
  'pin',
  'copy-session-id',
  'copy-resume-command',
  'swap-account',
  'take-over',
  'open-worktree',
  'open-machine',
  'reveal-transcript',
  'stop',
  'stop-and-remove',
  'remove',
  'delete-with-transcripts'
] as const

export type LiveSessionMenuItemId = (typeof LIVE_SESSION_MENU_ITEM_IDS)[number]

/** Actions that end an agent or hide or delete a session; each asks before it acts. */
export type LiveSessionDangerKind =
  | 'stop'
  | 'stop-and-remove'
  | 'remove'
  | 'delete-with-transcripts'

/** What the menu knows about a session beyond the registry's record. */
export type LiveSessionMenuContext = {
  /** The workspace it runs in, when Seal knows one. */
  worktreeId: string | null
  /** Accounts it can move to; empty when Seal did not launch it or has no other login. */
  swapAccounts: readonly { key: string; label: string; current: boolean }[]
  canTakeOver: boolean
}

/** Everything a menu item can do. Views implement these once; every menu surface shares them. */
export type LiveSessionMenuEffects = {
  open: (sessionId: string, mode: LiveSessionOpenMode) => void
  /** Opens the session and shows that part of its view. */
  focus: (sessionId: string, target: LiveSessionFocusTarget) => void
  askRename: (session: LiveSession) => void
  askMessage: (session: LiveSession) => void
  setPinned: (session: LiveSession, pinned: boolean) => void
  copy: (text: string, what: 'session-id' | 'resume-command') => void
  swapAccount: (session: LiveSession, accountKey: string) => void
  takeOver: (session: LiveSession) => void
  openWorktree: (worktreeId: string) => void
  openMachine: (session: LiveSession) => void
  revealTranscript: (session: LiveSession) => void
  /** Shows what will happen and only acts once the user agrees. */
  confirm: (kind: LiveSessionDangerKind, sessions: LiveSession[]) => void
}

export type LiveSessionMenuItemState = {
  id: LiveSessionMenuItemId
  /** Shown but not selectable, e.g. no permission is pending. */
  disabled: boolean
  destructive: boolean
  /** Drawn before a separator: where a new group of items starts. */
  startsGroup: boolean
}

const GROUP_STARTS: ReadonlySet<LiveSessionMenuItemId> = new Set([
  'send-message',
  'rename',
  'copy-session-id',
  'swap-account',
  'open-worktree',
  'stop'
])

const DESTRUCTIVE: ReadonlySet<LiveSessionMenuItemId> = new Set([
  'stop',
  'stop-and-remove',
  'remove',
  'delete-with-transcripts'
])

function isDisabled(
  id: LiveSessionMenuItemId,
  session: LiveSession,
  context: LiveSessionMenuContext
): boolean {
  switch (id) {
    case 'open':
    case 'open-new-tab':
    case 'open-split':
    case 'rename':
    case 'pin':
    case 'copy-session-id':
    case 'open-machine':
    case 'view-reasoning':
    case 'remove':
      return false
    case 'send-message':
      return session.inputRoutes.length === 0
    case 'answer-permission':
      return session.permission === null
    case 'view-subagents':
      return (session.activity?.subagents.length ?? 0) === 0
    case 'view-tasks':
      return (
        (session.activity?.tasks.length ?? 0) === 0 && (session.activity?.todos.length ?? 0) === 0
      )
    case 'copy-resume-command':
      return session.providerSessionId.startsWith('pid-')
    case 'swap-account':
      return context.swapAccounts.length === 0
    case 'take-over':
      return !context.canTakeOver
    case 'open-worktree':
      return context.worktreeId === null
    case 'reveal-transcript':
    case 'delete-with-transcripts':
      return session.transcriptPath === null
    case 'stop':
    case 'stop-and-remove':
      return !session.alive
  }
}

/** Every item, in menu order, with whether this session can use it right now. */
export function liveSessionMenuItems(
  session: LiveSession,
  context: LiveSessionMenuContext
): LiveSessionMenuItemState[] {
  return LIVE_SESSION_MENU_ITEM_IDS.map((id) => ({
    id,
    disabled: isDisabled(id, session, context),
    destructive: DESTRUCTIVE.has(id),
    startsGroup: GROUP_STARTS.has(id)
  }))
}

export type LiveSessionMenuArgs = {
  /** `copy-resume-command`: the command line for this session on its machine. */
  resumeCommand: string
  /** `swap-account`: the account picked in the submenu. */
  accountKey?: string
}

/** Runs one menu item. Dangerous items only ever ask; nothing here stops or deletes. */
export function runLiveSessionMenuItem(
  id: LiveSessionMenuItemId,
  session: LiveSession,
  context: LiveSessionMenuContext,
  effects: LiveSessionMenuEffects,
  args: LiveSessionMenuArgs
): void {
  switch (id) {
    case 'open':
      return effects.open(session.id, 'preview')
    case 'open-new-tab':
      return effects.open(session.id, 'tab')
    case 'open-split':
      return effects.open(session.id, 'split')
    case 'send-message':
      return effects.askMessage(session)
    case 'answer-permission':
      return effects.focus(session.id, 'permission')
    case 'view-subagents':
      return effects.focus(session.id, 'subagents')
    case 'view-tasks':
      return effects.focus(session.id, 'tasks')
    case 'view-reasoning':
      return effects.focus(session.id, 'reasoning')
    case 'rename':
      return effects.askRename(session)
    case 'pin':
      return effects.setPinned(session, session.pinned !== true)
    case 'copy-session-id':
      return effects.copy(session.providerSessionId, 'session-id')
    case 'copy-resume-command':
      return effects.copy(args.resumeCommand, 'resume-command')
    case 'swap-account':
      if (args.accountKey) {
        effects.swapAccount(session, args.accountKey)
      }
      return
    case 'take-over':
      return effects.takeOver(session)
    case 'open-worktree':
      if (context.worktreeId) {
        effects.openWorktree(context.worktreeId)
      }
      return
    case 'open-machine':
      return effects.openMachine(session)
    case 'reveal-transcript':
      return effects.revealTranscript(session)
    case 'stop':
    case 'stop-and-remove':
    case 'remove':
    case 'delete-with-transcripts':
      return effects.confirm(id, [session])
  }
}

/** What a confirmed dangerous action asks the registry to do. */
export function removeRequestFor(
  kind: LiveSessionDangerKind,
  sessions: readonly Pick<LiveSession, 'id' | 'alive'>[]
): LiveRemoveRequest {
  const sessionIds = sessions.map((session) => session.id)
  switch (kind) {
    case 'stop':
      return { sessionIds, stop: true, deleteTranscripts: false, keep: true }
    case 'stop-and-remove':
      return { sessionIds, stop: true, deleteTranscripts: false }
    case 'remove':
      return { sessionIds, stop: false, deleteTranscripts: false }
    case 'delete-with-transcripts':
      // Deleting the files of a running agent would only make it write them again.
      return {
        sessionIds,
        stop: sessions.some((session) => session.alive),
        deleteTranscripts: true
      }
  }
}
