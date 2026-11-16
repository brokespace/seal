import type {
  AgentSessionSurface,
  LiveSession,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
import type { OwedChatNames } from './owed-chat-names'
import { unrefTimer } from './unref-timer'

type ChatName = { name: string | null; user: boolean }

export type SessionTitleWriteThroughDeps = {
  /** The chat's own name: `user` when the user gave it (not auto-named). Null when this host does not hold the chat. */
  chatName: (chatSessionId: string) => ChatName | null
  /** Names the chat as its user. Resolves false when it did not apply: the host refuses an empty name. */
  renameChat: (chatSessionId: string, name: string) => Promise<boolean>
  /** The chat's name may have changed (it was renamed in its tab, or auto-named). */
  subscribeChatNames: (listener: (chatSessionId: string) => void) => () => void
  /** Sets a CLI pane's terminal tab title; null goes back to the tab's own title. */
  renameCliTab: (paneKey: string, title: string | null) => void
  /** Saves the session's custom title in Seal (the annotation). */
  annotate: (sessionId: string, customTitle: string | null) => void
  /** Waits out the backoff before a chat is asked again to take a name. */
  setTimer?: typeof unrefTimer
  /** Row names their chats have not taken; kept across restarts when saved. */
  owed?: OwedChatNames
  log?: (message: string, error?: unknown) => void
}

const FIRST_RETRY_MS = 5_000
const LONGEST_RETRY_MS = 5 * 60_000
const MAX_ATTEMPTS = 6

/** A row name its chat has not taken; the row keeps it for as long as this stands. */
type Unsent = {
  /** The chat's user-given name when the write began: a different one since is the user's own. */
  chatHad: string | null
  attempts: number
  cancelRetry: (() => void) | null
}

type Agreed = {
  /** The session's id now; it changes when its transcript names it. */
  recordId: string
  /** The custom title the row and the session's owner last agreed on. */
  title: string | null
  /** The chat or pane the session runs on; one that moves to another is met afresh. */
  owner: string
  /** The row title an annotation of ours replaces, until the registry publishes ours. */
  replacing?: string | null
  /** A chat this host does not hold yet: nothing is agreed, `title` is only the row's. */
  unheld?: true
  unsent?: Unsent
}

function chatOwner(chatSessionId: string): string {
  return `chat:${chatSessionId}`
}

function ownerOf(surface: AgentSessionSurface): string {
  if (surface.kind === 'chat') {
    return chatOwner(surface.sessionId)
  }
  return surface.kind === 'cli' ? `cli:${surface.paneKey}` : 'external'
}

/** Only a name the user gave is a custom title; an automatic one stays the chat's own. */
function userGivenName(chat: ChatName | null): string | null {
  return (chat?.user && chat.name) || null
}

/**
 * Keeps a session's row and its tab under one name. A rename on the row goes to whoever owns the
 * session (its chat, its terminal tab), and a chat renamed in its tab renames its row.
 */
export class SessionTitleWriteThrough {
  private readonly agreed = new Map<string, Agreed>()
  /** Renames of ours in flight, by chat. */
  private readonly renaming = new Map<string, number>()
  private readonly setTimer: NonNullable<SessionTitleWriteThroughDeps['setTimer']>
  private readonly owed: OwedChatNames
  private stopWatchingChats: (() => void) | null = null

  constructor(private readonly deps: SessionTitleWriteThroughDeps) {
    this.setTimer = deps.setTimer ?? unrefTimer
    this.owed = deps.owed ?? new Map()
  }

  observe(event: LiveSessionRegistryEvent): void {
    if (event.type === 'snapshot') {
      for (const session of event.snapshot.sessions) {
        this.sighted(session)
      }
    } else if (event.type === 'upsert') {
      this.sighted(event.session)
    } else if (event.type === 'remove') {
      const known = this.agreed.get(event.sessionId)
      this.agreed.delete(event.sessionId)
      // The successor's own sighting, when the registry published it first, is the newer word.
      if (known && event.replacedBy && !this.agreed.has(event.replacedBy)) {
        known.recordId = event.replacedBy
        this.agreed.set(event.replacedBy, known)
      } else if (known) {
        this.dropUnsent(known)
      }
    }
  }

  dispose(): void {
    this.stopWatchingChats?.()
    this.stopWatchingChats = null
    for (const known of this.agreed.values()) {
      this.dropUnsent(known)
    }
    this.agreed.clear()
    this.renaming.clear()
  }

  private sighted(session: LiveSession): void {
    const surface = session.surface
    const owner = ownerOf(surface)
    const title = session.customTitle?.trim() || null
    if (surface.kind === 'chat') {
      // Not at construction: the structured host is installed with the first chat.
      this.stopWatchingChats ??= this.deps.subscribeChatNames((chat) => this.chatNameChanged(chat))
    }
    const known = this.agreed.get(session.id)
    if (!known || known.owner !== owner || known.unheld) {
      this.firstSighting(surface.kind === 'chat' ? surface.sessionId : null, {
        recordId: session.id,
        title,
        owner
      })
      return
    }
    if (title === known.title) {
      delete known.replacing
      return
    }
    // A republish from before our annotation landed is not the user naming the row back.
    if (title === known.replacing) {
      return
    }
    known.title = title
    delete known.replacing
    if (surface.kind === 'chat') {
      this.sendToChat(known, surface.sessionId)
    } else if (surface.kind === 'cli') {
      this.deps.renameCliTab(surface.paneKey, title)
    }
  }

  /** A tab keeps the title it had before Seal first saw its session; only a chat is brought to agree. */
  private firstSighting(chatSessionId: string | null, row: Agreed): void {
    const before = this.agreed.get(row.recordId)
    if (before) {
      this.dropUnsent(before)
    }
    this.agreed.set(row.recordId, row)
    if (chatSessionId === null) {
      return
    }
    const chat = this.deps.chatName(chatSessionId)
    if (!chat) {
      row.unheld = true
      if (before?.unheld && before.owner === row.owner && before.title !== row.title) {
        // Renamed while its chat is out of reach: whatever name the chat has by then is older.
        this.owe(chatSessionId, row.title)
      }
      return
    }
    const name = userGivenName(chat)
    const owed = this.owed.get(chatSessionId)
    // A chat renamed while its row was not listed is newer than the row; an owed name is not.
    const rowIsNewer =
      owed?.title === row.title && (owed.chatHad === undefined || owed.chatHad === name)
    if (row.title !== null && row.title !== name && (name === null || rowIsNewer)) {
      this.sendToChat(row, chatSessionId)
      return
    }
    this.owed.delete(chatSessionId)
    if (name !== null) {
      this.nameRow(row, name)
    }
  }

  private owe(chatSessionId: string, title: string | null, chatHad?: string | null): void {
    if (title === null) {
      this.owed.delete(chatSessionId)
    } else {
      const had = chatHad === undefined ? {} : { chatHad }
      this.owed.set(chatSessionId, { chatSessionId, title, ...had })
    }
  }

  private chatNameChanged(chatSessionId: string): void {
    const chat = this.renaming.has(chatSessionId) ? null : this.deps.chatName(chatSessionId)
    if (!chat) {
      return
    }
    const owner = chatOwner(chatSessionId)
    const name = userGivenName(chat)
    for (const known of this.agreed.values()) {
      if (known.owner !== owner) {
        continue
      }
      if (known.unheld) {
        this.firstSighting(chatSessionId, { recordId: known.recordId, title: known.title, owner })
      } else if (!known.unsent || (name !== null && name !== known.unsent.chatHad)) {
        this.dropUnsent(known)
        this.owed.delete(chatSessionId)
        this.nameRow(known, name)
      }
    }
  }

  private nameRow(known: Agreed, title: string | null): void {
    if (known.title === title) {
      return
    }
    if (known.replacing === undefined) {
      known.replacing = known.title
    }
    known.title = title
    this.deps.annotate(known.recordId, title)
  }

  private dropUnsent(known: Agreed): void {
    known.unsent?.cancelRetry?.()
    delete known.unsent
  }

  /** The row's title goes to its chat; a name starts over, a cleared one is the chat's to refuse. */
  private sendToChat(known: Agreed, chatSessionId: string): void {
    this.dropUnsent(known)
    if (known.title !== null) {
      const chatHad = userGivenName(this.deps.chatName(chatSessionId))
      known.unsent = { chatHad, attempts: 1, cancelRetry: null }
    }
    this.owe(chatSessionId, known.title, known.unsent?.chatHad)
    this.renameChat(known, chatSessionId, known.unsent ?? null)
  }

  private renameChat(known: Agreed, chatSessionId: string, unsent: Unsent | null): void {
    this.renaming.set(chatSessionId, (this.renaming.get(chatSessionId) ?? 0) + 1)
    void this.deps
      .renameChat(chatSessionId, known.title ?? '')
      .then(
        (applied): { applied: boolean; error?: unknown } => ({ applied }),
        (error: unknown) => ({ applied: false, error })
      )
      .then(({ applied, error }) => {
        const left = (this.renaming.get(chatSessionId) ?? 1) - 1
        if (left > 0) {
          this.renaming.set(chatSessionId, left)
        } else {
          this.renaming.delete(chatSessionId)
        }
        if (unsent && known.unsent === unsent) {
          this.attempted(known, chatSessionId, unsent, applied, error)
        } else if (applied && known.unsent) {
          // An earlier write of ours landed: its name is not the user renaming the chat.
          known.unsent.chatHad = userGivenName(this.deps.chatName(chatSessionId))
        } else if (error !== undefined) {
          this.deps.log?.('[session-titles] renaming a chat failed', error)
        }
        if (left === 0) {
          // Whatever the host made of the name (refused it, trimmed it), the row takes the chat's.
          this.chatNameChanged(chatSessionId)
        }
      })
  }

  /** A name the chat did not take stays on the row and is written again, a few times, further apart. */
  private attempted(
    known: Agreed,
    chatSessionId: string,
    unsent: Unsent,
    applied: boolean,
    error: unknown
  ): void {
    const name = userGivenName(this.deps.chatName(chatSessionId))
    if (applied || name === known.title || (name !== null && name !== unsent.chatHad)) {
      delete known.unsent
      this.owed.delete(chatSessionId)
      return
    }
    if (unsent.attempts >= MAX_ATTEMPTS) {
      this.deps.log?.(
        `[session-titles] a chat did not take its row's name in ${MAX_ATTEMPTS} attempts; the row keeps it and the next start writes it again`,
        error
      )
      return
    }
    const delayMs = Math.min(FIRST_RETRY_MS * 2 ** (unsent.attempts - 1), LONGEST_RETRY_MS)
    this.deps.log?.(
      `[session-titles] a chat did not take its row's name; the row keeps it, next attempt in ${delayMs / 1000} s`,
      error
    )
    unsent.cancelRetry = this.setTimer(() => {
      unsent.cancelRetry = null
      unsent.attempts++
      this.renameChat(known, chatSessionId, unsent)
    }, delayMs).cancel
  }
}
