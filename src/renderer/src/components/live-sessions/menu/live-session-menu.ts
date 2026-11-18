import { agentSessionAdapter } from '../../../../../shared/live-sessions/adapters/agent-session-adapters'
import { isProvisionalLiveSessionId } from '../../../../../shared/live-sessions/live-session-provisional-id'
import type {
  LiveRemoveRequest,
  LiveSession,
  LiveSessionProject
} from '../../../../../shared/live-sessions/live-session-types'
import type { AgentSessionFocusTarget } from '../chat/agent-session-focus-requests'
import type { SessionProjectChoices } from '../links/session-project-choices'
import type { AgentSessionOpenMode } from '../open/agent-session-open-mode'
import { isChatTabOf, type TabContent } from '../open/agent-session-tab-match'

export const LIVE_SESSION_MENU_ITEM_IDS = [
  'open',
  'open-new-tab',
  'open-split',
  'send-message',
  'answer-permission',
  'view-subagents',
  'view-tasks',
  'rename',
  'pin',
  'move-to-project',
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
  /** Projects it can be listed under, and whether the user already chose one. */
  projects: SessionProjectChoices
  canTakeOver: boolean
}

/** Everything a menu item can do. Views implement these once; every menu surface shares them. */
export type LiveSessionMenuEffects = {
  open: (session: LiveSession, mode: AgentSessionOpenMode) => void
  /** Opens the session and shows that part of its view. */
  focus: (sessionId: string, target: AgentSessionFocusTarget) => void
  askRename: (session: LiveSession) => void
  askMessage: (session: LiveSession) => void
  setPinned: (session: LiveSession, pinned: boolean) => void
  /** Lists the session under `project`; null gives it back to automatic placement. */
  moveToProject: (session: LiveSession, project: LiveSessionProject | null) => void
  askNewProject: (session: LiveSession) => void
  copy: (text: string, what: 'session-id' | 'resume-command') => void
  swapAccount: (session: LiveSession, accountKey: string) => void
  takeOver: (session: LiveSession) => void
  openWorktree: (worktreeId: string, session: LiveSession) => void
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
    case 'move-to-project':
    case 'copy-session-id':
    case 'open-machine':
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
      return (
        isProvisionalLiveSessionId(session.providerSessionId) ||
        !agentSessionAdapter(session.provider)?.cli?.resumeArgv
      )
    case 'swap-account':
      return context.swapAccounts.length === 0
    case 'take-over':
      return !context.canTakeOver
    case 'open-worktree':
      return context.worktreeId === null
    case 'reveal-transcript':
      return session.transcriptPath === null
    case 'delete-with-transcripts':
      // A chat's host finds its transcript by the provider's session id; deleting closes its tab either way.
      return session.transcriptPath === null && session.surface.kind !== 'chat'
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
  /** `move-to-project`: the project picked in the submenu, `'new'` to name one, null for automatic. */
  project?: LiveSessionProject | null | 'new'
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
      return effects.open(session, 'preview')
    case 'open-new-tab':
      return effects.open(session, 'tab')
    case 'open-split':
      return effects.open(session, 'split')
    case 'send-message':
      return effects.askMessage(session)
    case 'answer-permission':
      return effects.focus(session.id, 'permission')
    case 'view-subagents':
      return effects.focus(session.id, 'subagents')
    case 'view-tasks':
      return effects.focus(session.id, 'tasks')
    case 'rename':
      return effects.askRename(session)
    case 'pin':
      return effects.setPinned(session, session.pinned !== true)
    case 'move-to-project':
      if (args.project === 'new') {
        effects.askNewProject(session)
      } else if (args.project !== undefined) {
        effects.moveToProject(session, args.project)
      }
      return
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
        effects.openWorktree(context.worktreeId, session)
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

/** The chat tabs a confirmed action closes: a chat leaves Seal the way its tab closes, on its own host. */
export function chatTabsClosedBy(
  kind: LiveSessionDangerKind,
  sessions: readonly Pick<LiveSession, 'surface'>[],
  tabsByWorktree: Readonly<Record<string, readonly (TabContent & { id: string })[]>>
): string[] {
  if (kind === 'stop') {
    return []
  }
  const tabs = Object.values(tabsByWorktree).flat()
  return sessions.flatMap(({ surface }) =>
    surface.kind === 'chat'
      ? tabs.filter((tab) => isChatTabOf(tab, surface.sessionId)).map((tab) => tab.id)
      : []
  )
}
