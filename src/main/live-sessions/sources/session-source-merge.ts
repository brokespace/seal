import type {
  LiveSession,
  LiveSessionMachine
} from '../../../shared/live-sessions/live-session-types'
import { mergeSealPanes, type SealPane } from '../seal-panes/seal-pane-sessions'

/** An earlier transcript of a chat's conversation that the scan found on its own. */
function isEarlierTranscript(session: LiveSession, chat: LiveSession): boolean {
  return (
    session.surface.kind === 'external' &&
    !session.alive &&
    chat.continues?.includes(session.id) === true
  )
}

/**
 * A chat owns its record: where it runs, how it is reached and what it is doing come from its
 * host. What a pane or the scan knows of the same session only fills what the chat left empty.
 */
function chatOver(chat: LiveSession, lower: LiveSession): LiveSession {
  const continues = [...new Set([...(chat.continues ?? []), ...(lower.continues ?? [])])]
  return {
    ...chat,
    cwd: chat.cwd ?? lower.cwd,
    project: chat.project ?? lower.project,
    title: chat.title ?? lower.title,
    startedAt: chat.startedAt ?? lower.startedAt,
    pid: chat.pid ?? lower.pid,
    transcriptPath: chat.transcriptPath ?? lower.transcriptPath,
    lastActivityAt: Math.max(chat.lastActivityAt, lower.lastActivityAt),
    ...(chat.activity === undefined && lower.activity ? { activity: lower.activity } : {}),
    ...(chat.lastMessage == null && lower.lastMessage ? { lastMessage: lower.lastMessage } : {}),
    ...(chat.configDir == null && lower.configDir ? { configDir: lower.configDir } : {}),
    // A chat measures from its first reply on; until then the transcript's reading stands.
    ...(chat.context === undefined && lower.context ? { context: lower.context } : {}),
    ...(chat.model === undefined && lower.model ? { model: lower.model } : {}),
    ...(chat.title === null && lower.titleNamed ? { titleNamed: true as const } : {}),
    ...(continues.length > 0 ? { continues } : {})
  }
}

/** One record per session id. Ownership goes chat, then Seal pane, then the scan. */
export function mergeSessionSources(input: {
  discovered: LiveSession[]
  panes: SealPane[]
  chats: LiveSession[]
  localMachine: LiveSessionMachine
  /** Told of each pane whose session the scan finds with no process running it. */
  onUnseenAgent?: (paneKey: string) => void
}): LiveSession[] {
  const lower = mergeSealPanes(
    input.discovered,
    input.panes,
    input.localMachine,
    input.onUnseenAgent
  )
  if (input.chats.length === 0) {
    return lower
  }
  const chats = new Map(input.chats.map((chat) => [chat.id, chat]))
  const merged = new Set<string>()
  const out: LiveSession[] = []
  for (const session of lower) {
    const chat = chats.get(session.id)
    if (chat) {
      merged.add(chat.id)
      out.push(chatOver(chat, session))
    } else if (!input.chats.some((owner) => isEarlierTranscript(session, owner))) {
      out.push(session)
    }
  }
  return [...out, ...input.chats.filter((chat) => !merged.has(chat.id))]
}
