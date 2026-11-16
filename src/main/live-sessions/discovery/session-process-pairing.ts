// Which running agent process writes which transcript.
import { sessionIdFromArgs, type AgentProcess } from './agent-processes'
import type { DiscoveredFile } from './discovery-output'
import type { SummarizedTranscript } from './session-assembly'

export type ProcessClaim = {
  transcript: SummarizedTranscript | null
  process: AgentProcess | null
  /** Several agents could each have written this transcript, and one that could still runs. */
  contested?: boolean
}

/** `ps` and file times are whole seconds, read moments apart. */
const CLOCK_SLACK_MS = 2_000

/**
 * Whether `process` may be what writes a transcript nothing names as its own: one begun after
 * the process started, that no other process was seen writing. A transcript begun earlier and
 * written again says nothing: Seal's own resume writes it, as anyone's may. An agent carrying
 * an earlier session on (`claude --continue`) is known by its registry entry or its open file.
 */
function couldWrite(process: AgentProcess, transcript: SummarizedTranscript): boolean {
  if (transcript.agentPid !== undefined && transcript.agentPid !== process.pid) {
    return false
  }
  const began = transcript.summary.firstAt
  return (
    process.startedAtMs !== undefined &&
    began !== null &&
    began + CLOCK_SLACK_MS >= process.startedAtMs
  )
}

function couldWriteInFolder(process: AgentProcess, transcript: SummarizedTranscript): boolean {
  return (
    transcript.summary.provider === process.provider &&
    process.cwd !== null &&
    transcript.summary.cwd === process.cwd &&
    couldWrite(process, transcript)
  )
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
  /** Processes with no transcript, by provider: each is listed on its own as a new session. */
  const bare = new Map<string, ProcessClaim[]>()
  // Which of two agents started in one folder writes the transcript begun after both is not
  // known, nor once one of them has left: typing into either could reach the wrong one.
  const contested = new Set(
    [...free].filter(
      (t) => t.contested || pending.filter((p) => couldWriteInFolder(p, t)).length > 1
    )
  )
  for (const process of pending) {
    const match = [...free]
      .filter((t) => !contested.has(t) && couldWriteInFolder(process, t))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    // One still to be read may be its own (a shared app-server holds it open): shown then.
    const mayBeUnread =
      cutShort || [...unclaimed].some((file) => file.provider === process.provider)
    if (!match && mayBeUnread) {
      continue
    }
    const claim = { process, transcript: take(match) }
    claims.push(claim)
    if (!match) {
      bare.set(process.provider, [...(bare.get(process.provider) ?? []), claim])
    }
  }
  // The one agent whose folder is unknown may write the one transcript being written right now.
  // That is a guess: the transcript is listed without the process, so nothing is typed into the
  // agent or stops it on the transcript's behalf, and the agent is not listed a second time.
  for (const [provider, [only, ...others]] of bare) {
    const fresh = [...free].filter(
      (t) => t.summary.provider === provider && t.mtimeMs >= freshSince
    )
    const agent = others.length === 0 && fresh.length === 1 ? only.process : null
    if (
      agent &&
      (agent.cwd === null || fresh[0].summary.cwd === null) &&
      couldWrite(agent, fresh[0])
    ) {
      claims.splice(claims.indexOf(only), 1)
    }
  }
  claims.push(...unwritten)
  for (const transcript of free) {
    // One of the agents still here may be at its prompt with it: a resume would write beside it.
    const held = contested.has(transcript) && pending.some((p) => couldWriteInFolder(p, transcript))
    claims.push({ process: null, transcript, ...(held && { contested: true }) })
  }
  return claims
}
