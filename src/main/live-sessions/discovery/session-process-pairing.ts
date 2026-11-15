// Which running agent process writes which transcript.
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { sessionIdFromArgs } from './agent-processes'
import type { DiscoveredProcess } from './discovery-output'
import type { SummarizedTranscript } from './session-assembly'

export type ProcessClaim = {
  transcript: SummarizedTranscript | null
  process: (DiscoveredProcess & { provider: LiveSessionProvider }) | null
}

/** Pair agent processes with the transcripts they write. */
export function pairProcesses(
  processes: (DiscoveredProcess & { provider: LiveSessionProvider })[],
  transcripts: SummarizedTranscript[],
  claudeSessionByPid: ReadonlyMap<number, string>,
  ownedPaths: ReadonlyMap<number, ReadonlySet<string>>,
  freshSince: number
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
  for (const process of processes) {
    const named =
      (process.provider === 'claude' ? claudeSessionByPid.get(process.pid) : undefined) ??
      sessionIdFromArgs(process.args)
    const owned = ownedPaths.get(process.pid)
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
  for (const transcript of free) {
    claims.push({ process: null, transcript })
  }
  return claims
}
