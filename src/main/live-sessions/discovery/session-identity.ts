import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { SummarizedTranscript } from './session-assembly'

/**
 * One file per conversation: the newest copy of a session id, the newest file of a resume chain.
 * Headless runs are dropped: the program that drives them owns the conversation.
 */
export function conversationTranscripts(
  transcripts: readonly SummarizedTranscript[]
): SummarizedTranscript[] {
  const newest = new Map<string, SummarizedTranscript>()
  for (const t of transcripts) {
    const key = `${t.summary.provider}:${t.summary.providerSessionId}`
    const seen = newest.get(key)
    if (!t.summary.headless && (!seen || t.mtimeMs > seen.mtimeMs)) {
      newest.set(key, t)
    }
  }
  const files = [...newest.values()]
  const holders = new Map<string, SummarizedTranscript[]>()
  for (const t of files) {
    for (const id of t.summary.recordIds) {
      holders.set(id, [...(holders.get(id) ?? []), t])
    }
  }
  const continued = new Set<SummarizedTranscript>()
  for (const t of files) {
    // A resume either points at the record it continues or opens with a copy of the history.
    const links = [...t.summary.continues, ...t.summary.recordIds.slice(0, 1)]
    for (const earlier of links.flatMap((id) => holders.get(id) ?? [])) {
      if (earlier !== t && earlier.summary.provider === t.summary.provider) {
        continued.add(earlier.mtimeMs <= t.mtimeMs ? earlier : t)
      }
    }
  }
  return files.filter((t) => !continued.has(t))
}

function rank(session: LiveSession): number {
  return (session.alive ? 2 : 0) + (session.transcriptPath ? 1 : 0)
}

function identityKeys(session: LiveSession): string[] {
  const host = session.machine.hostId
  const pane = session.inputRoutes.find((route) => route.kind === 'tmux')
  return [
    session.id,
    ...(session.pid !== null ? [`pid:${host}:${session.pid}`] : []),
    ...(pane?.kind === 'tmux'
      ? [`pane:${host}:${pane.socket ?? ''}:${pane.target}:${session.provider}`]
      : [])
  ]
}

/** One card per conversation, per running process and per terminal pane; the liveliest wins. */
export function distinctSessions(sessions: readonly LiveSession[]): LiveSession[] {
  const seen = new Set<string>()
  const kept = new Set<LiveSession>()
  const best = [...sessions].sort(
    (a, b) => rank(b) - rank(a) || b.lastActivityAt - a.lastActivityAt
  )
  for (const session of best) {
    const keys = identityKeys(session)
    if (keys.every((key) => !seen.has(key))) {
      keys.forEach((key) => seen.add(key))
      kept.add(session)
    }
  }
  return sessions.filter((session) => kept.has(session))
}
