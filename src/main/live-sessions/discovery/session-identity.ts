import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { SummarizedTranscript } from './session-assembly'

export type Conversation = {
  transcript: SummarizedTranscript
  /** Provider session ids of the earlier files this one carries on (a resume after an error). */
  earlier: string[]
}

const MAX_CHAIN = 16

function newestPerSession(transcripts: readonly SummarizedTranscript[]): SummarizedTranscript[] {
  const newest = new Map<string, SummarizedTranscript>()
  for (const t of transcripts) {
    const key = `${t.summary.provider}:${t.summary.providerSessionId}`
    const seen = newest.get(key)
    if (!seen || t.mtimeMs > seen.mtimeMs) {
      newest.set(key, t)
    }
  }
  return [...newest.values()]
}

/**
 * One file per conversation: the newest copy of a session id, the newest file of a resume chain.
 * Headless runs are dropped: the program that drives them owns the conversation. A terminal
 * session that opens with a headless run's history (a chat forked into the CLI) still names it.
 */
export function conversations(transcripts: readonly SummarizedTranscript[]): Conversation[] {
  const files = newestPerSession(transcripts.filter((t) => !t.summary.headless))
  const headless = new Set(newestPerSession(transcripts.filter((t) => t.summary.headless)))
  const holders = new Map<string, SummarizedTranscript[]>()
  for (const t of [...files, ...headless]) {
    for (const id of t.summary.recordIds) {
      holders.set(id, [...(holders.get(id) ?? []), t])
    }
  }
  const continuedBy = new Map<SummarizedTranscript, SummarizedTranscript>()
  const forkedFrom = new Map<SummarizedTranscript, string[]>()
  for (const t of files) {
    // A resume either points at the record it continues or opens with a copy of the history.
    const links = [...t.summary.continues, ...t.summary.recordIds.slice(0, 1)]
    for (const other of links.flatMap((id) => holders.get(id) ?? [])) {
      if (other === t || other.summary.provider !== t.summary.provider) {
        continue
      }
      if (headless.has(other)) {
        // Its owner lists it and both go on: neither file folds into the other.
        const id = other.summary.providerSessionId
        if (id !== t.summary.providerSessionId) {
          forkedFrom.set(t, [...new Set([...(forkedFrom.get(t) ?? []), id])])
        }
        continue
      }
      // Files saved in the same instant still need one order, or each folds into the other.
      const otherIsOlder =
        other.mtimeMs < t.mtimeMs || (other.mtimeMs === t.mtimeMs && other.path < t.path)
      const [older, newer] = otherIsOlder ? [other, t] : [t, other]
      const known = continuedBy.get(older)
      if (!known || newer.mtimeMs > known.mtimeMs) {
        continuedBy.set(older, newer)
      }
    }
  }
  const earlier = new Map<SummarizedTranscript, string[]>()
  for (const t of continuedBy.keys()) {
    let last = t
    for (let hops = 0; hops < MAX_CHAIN && continuedBy.has(last); hops++) {
      last = continuedBy.get(last)!
    }
    if (last !== t && !continuedBy.has(last)) {
      earlier.set(last, [
        ...(earlier.get(last) ?? []),
        t.summary.providerSessionId,
        ...(forkedFrom.get(t) ?? [])
      ])
    }
  }
  return files
    .filter((t) => !continuedBy.has(t))
    .map((transcript) => ({
      transcript,
      earlier: [
        ...new Set([...(earlier.get(transcript) ?? []), ...(forkedFrom.get(transcript) ?? [])])
      ]
    }))
}

export function conversationTranscripts(
  transcripts: readonly SummarizedTranscript[]
): SummarizedTranscript[] {
  return conversations(transcripts).map((conversation) => conversation.transcript)
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
