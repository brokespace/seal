// Which running agent process writes which transcript.
import { sessionIdFromArgs, type AgentProcess } from './agent-processes'
import type { DiscoveredFile } from './discovery-output'
import type { SummarizedTranscript } from './session-assembly'

export type ProcessClaim = {
  transcript: SummarizedTranscript | null
  process: AgentProcess | null
}

/** A transcript the host listed but this scan's read budget has not reached yet. */
export type UnreadTranscript = Pick<DiscoveredFile, 'path' | 'provider'>

/** Pair agent processes with the transcripts they write. */
export function pairProcesses(
  processes: AgentProcess[],
  transcripts: SummarizedTranscript[],
  claudeSessionByPid: ReadonlyMap<number, string>,
  ownedPaths: ReadonlyMap<number, ReadonlySet<string>>,
  freshSince: number,
  unread: readonly UnreadTranscript[] = [],
  /** The scan ended before the host had listed every transcript. */
  cutShort = false
): ProcessClaim[] {
  const free = new Set(transcripts)
  const claims: ProcessClaim[] = []
  const take = (t: SummarizedTranscript | undefined) => {
    if (t) {
      free.delete(t)
    }
    return t ?? null
  }
  const pending: typeof processes = []
  const unwritten: ProcessClaim[] = []
  /** Unread transcripts no process is known to write: any could be a nameless agent's own. */
  const unclaimed = new Set(unread)
  for (const process of processes) {
    const registered =
      process.provider === 'claude' ? claudeSessionByPid.get(process.pid) : undefined
    const named = registered ?? sessionIdFromArgs(process.args)
    const owned = ownedPaths.get(process.pid)
    const own = unread.filter(
      ({ path }) => owned?.has(path) || (named && path.endsWith(`${named}.jsonl`))
    )
    // Its own transcript is still to be read: shown then, not as idle or under another session.
    if (own.length > 0) {
      own.forEach((file) => unclaimed.delete(file))
      continue
    }
    const match =
      (named
        ? [...free].find(
            (t) => t.summary.provider === process.provider && t.summary.providerSessionId === named
          )
        : undefined) ??
      [...free]
        .filter((t) => t.summary.provider === process.provider && owned?.has(t.path))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (match) {
      claims.push({ process, transcript: take(match) })
    } else if (registered) {
      // Claude names its conversation before it writes one: an earlier session's transcript in
      // the same folder is not this agent's.
      unwritten.push({ process, transcript: null })
    } else {
      pending.push(process)
    }
  }
  // Newer processes write the newer transcripts in a shared folder.
  pending.sort((a, b) => b.pid - a.pid)
  for (const process of pending) {
    const match = [...free]
      .filter((t) => t.summary.provider === process.provider && t.summary.cwd === process.cwd)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    // One still to be read may be its own (a shared app-server holds it open): shown then.
    const mayBeUnread =
      cutShort || [...unclaimed].some((file) => file.provider === process.provider)
    if (!match && mayBeUnread) {
      continue
    }
    claims.push({ process, transcript: take(match) })
  }
  // A running agent's transcript is being written right now even when its folder says otherwise.
  for (const provider of ['claude', 'codex'] as const) {
    const bare = claims.filter((c) => c.process?.provider === provider && !c.transcript)
    const fresh = [...free].filter(
      (t) => t.summary.provider === provider && t.mtimeMs >= freshSince
    )
    if (bare.length === 1 && fresh.length === 1) {
      bare[0].transcript = take(fresh[0])
    }
  }
  claims.push(...unwritten)
  for (const transcript of free) {
    claims.push({ process: null, transcript })
  }
  return claims
}
