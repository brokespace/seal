// Which of the jobs a Claude Code session left running by themselves still run: asked of the
// host's processes, since Claude Code tracks no task for them and never says they ended.
import { detachedJobOf, type ClaudeBackgroundLaunch } from './claude-background-launches'
import { replyJobLabel, replyJobNames } from './detached-shell-jobs'
import { claudeSessionLaunches } from './claude-session-launches'
import type { DiscoveredJob } from './discovered-host-jobs'
import type { HostJobQuery } from './discovery-script'
import type { SummarizedTranscript } from './session-assembly'

/** A running job the reply names that no launch read from the transcript accounts for. */
export type NamedJob = {
  /** What the reply calls it: `fq_cache.py`, `PID 4821`. */
  label: string
  pid: number
  startedAt: number
  /** The executable's name. */
  runs: string
}

export type NamedJobs = { key: string; jobs: NamedJob[] }

export type JobLookup = HostJobQuery & {
  key: string
  transcript: SummarizedTranscript
  /** Null for the jobs the reply names. */
  launch: ClaudeBackgroundLaunch | null
}

/** A scan's script stays small: the newest jobs are the ones a session may still wait on. */
const MAX_LOOKUPS = 24

const seconds = (ms: number): number => Math.floor(ms / 1000)

function launchesOf(transcript: SummarizedTranscript): ClaudeBackgroundLaunch[] {
  return claudeSessionLaunches(transcript.claudeActivity, transcript.subagents).map(
    ({ launch }) => launch
  )
}

function keyed(
  transcript: SummarizedTranscript,
  launch: ClaudeBackgroundLaunch | null,
  query: HostJobQuery
): JobLookup {
  const asked = [query.from, query.until, ...query.names].join(' ')
  return {
    ...query,
    key: `${transcript.path}\n${launch?.toolUseId ?? ''}\n${asked}`,
    transcript,
    launch
  }
}

/**
 * The jobs a reply names that no launch does, started since the user last spoke: a job set off
 * from a script, or by a call that lies before what was read of the transcript.
 */
function replyLookup(transcript: SummarizedTranscript): JobLookup | null {
  const state = transcript.claudeActivity
  const turn = transcript.summary
  const since = state?.userSpokeAt ?? null
  if (
    turn.phase !== 'turn-ended' ||
    turn.detail === 'Interrupted' ||
    since === null ||
    turn.lastAt === null
  ) {
    return null
  }
  const launches = launchesOf(transcript)
  const names = replyJobNames(turn.replyExcerpt ?? turn.lastMessage).filter(
    (name) =>
      !launches.some(
        (launch) => launch.command?.includes(name) || launch.detached?.names.includes(name)
      )
  )
  return names.length > 0
    ? keyed(transcript, null, {
        from: seconds(since),
        until: seconds(turn.lastAt),
        names,
        noTerminal: true
      })
    : null
}

/** What to ask a host: every detached job not yet known to be over, and what each reply names. */
export function jobLookups(transcripts: readonly SummarizedTranscript[]): JobLookup[] {
  const lookups: JobLookup[] = []
  for (const transcript of transcripts) {
    for (const launch of launchesOf(transcript)) {
      const job = detachedJobOf(launch)
      if (job && job.names.length > 0 && job.runs?.length !== 0) {
        lookups.push(
          keyed(transcript, launch, {
            from: seconds(job.from),
            until: seconds(job.until),
            names: job.names,
            noTerminal: false
          })
        )
      }
    }
    const named = replyLookup(transcript)
    if (named) {
      lookups.push(named)
    }
  }
  return lookups.sort((a, b) => b.until - a.until).slice(0, MAX_LOOKUPS)
}

/** What a host found for each lookup it was asked; null when it did not list its processes. */
export function jobAnswers(
  asked: readonly JobLookup[],
  found: readonly DiscoveredJob[] | null
): Map<string, DiscoveredJob[]> | null {
  if (found === null) {
    return null
  }
  const answers = new Map<string, DiscoveredJob[]>(asked.map((lookup) => [lookup.key, []]))
  for (const job of found) {
    const lookup = asked[job.query]
    if (lookup) {
      answers.get(lookup.key)!.push(job)
    }
  }
  return answers
}

/**
 * Records what the host found. A job with no process left is over for good; one the host was
 * not asked about, or could not answer for, stands as the last scan left it.
 */
export function settleJobLookups(
  transcripts: readonly SummarizedTranscript[],
  lookups: readonly JobLookup[],
  answers: Map<string, DiscoveredJob[]> | null
): void {
  const claimed = new Set<number>()
  const named = new Map<SummarizedTranscript, NamedJobs>()
  for (const lookup of lookups) {
    const found = answers?.get(lookup.key)
    const job = lookup.launch?.detached
    if (found && job) {
      job.runs = [...new Set(found.map((process) => process.command))].sort()
      job.seen ||= found.length > 0
      found.forEach((process) => claimed.add(process.pid))
    }
  }
  for (const lookup of lookups) {
    if (lookup.launch) {
      continue
    }
    const found = answers?.get(lookup.key)
    const last = lookup.transcript.namedJobs
    if (found) {
      named.set(lookup.transcript, {
        key: lookup.key,
        jobs: found
          .filter((process) => !claimed.has(process.pid))
          .map((process) => ({
            label: replyJobLabel(lookup.names[process.name] ?? process.command),
            pid: process.pid,
            startedAt: process.startedAtMs,
            runs: process.command
          }))
      })
    } else if (last?.key === lookup.key) {
      named.set(lookup.transcript, last)
    }
  }
  for (const transcript of transcripts) {
    transcript.namedJobs = named.get(transcript)
  }
}
