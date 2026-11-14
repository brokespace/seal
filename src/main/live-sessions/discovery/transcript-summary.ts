import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { codexUserMessageText } from './codex-user-message'
import { claudePhase, claudePromptText } from './claude-transcript-phase'
import { codexPhase } from './codex-transcript-phase'
import { basename, oneLine, rec, recordsOf, str, timeOf } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'

export { oneLine } from './transcript-records'

/** What the transcript alone says; liveness, hooks and the screen refine it later. */
export type TranscriptPhase =
  /** A prompt or tool result is being worked on. */
  | 'working'
  /** A tool call has no result yet: running, or waiting on an approval only the screen can tell. */
  | 'tool-pending'
  | 'approval-requested'
  /** The agent put a question or a plan to the user and waits for the answer. */
  | 'input-requested'
  /** The turn ended; the agent sits at its prompt. */
  | 'turn-ended'
  | 'errored'
  | 'unknown'

export type TranscriptTurn = {
  phase: TranscriptPhase
  /** The tool or error behind `phase`, one line. */
  detail: string | null
  /** The tool a `tool-pending` phase waits on. */
  pendingTool: string | null
  /** The turn ended on a question to the user. */
  asksUser: boolean
  /** The transcript recorded the turn's end, rather than just stopping after a reply. */
  settled: boolean
  /** The agent's newest reply, one line. */
  lastMessage: string | null
}

export type TranscriptSummary = TranscriptTurn & {
  provider: LiveSessionProvider
  providerSessionId: string
  cwd: string | null
  title: string | null
  /** The title is a name the user gave the session in the agent, not a prompt or the agent's summary. */
  titleNamed?: true
  firstAt: number | null
  lastAt: number | null
  /** Another program drives it (`claude -p`, an Agent SDK host such as Seal's Home chat, `codex exec`). */
  headless: boolean
  /** Record ids seen in the head and tail, for linking a resumed copy to what it continues. */
  recordIds: string[]
  /** Record ids this file says it continues from: a parent it does not hold, a summary's leaf. */
  continues: string[]
  /** Codex: the thread that spawned this one as a helper; such a rollout is a subagent, not a session. */
  parentSessionId: string | null
  /** Codex: what the spawning thread called this helper. */
  agentName: string | null
  agentType: string | null
}

export const UNKNOWN_TURN: TranscriptTurn = {
  phase: 'unknown',
  detail: null,
  pendingTool: null,
  asksUser: false,
  settled: false,
  lastMessage: null
}

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

function claudeIdentity(
  head: TranscriptRecord[],
  tail: TranscriptRecord[]
): Pick<TranscriptSummary, 'headless' | 'recordIds' | 'continues'> {
  const headIds = new Set(head.map((r) => str(r.uuid)).filter((id): id is string => id !== null))
  const firstParent = head.map((r) => str(r.parentUuid)).find((id) => id !== null)
  const leaves = head
    .filter((r) => r.type === 'summary')
    .map((r) => str(r.leafUuid))
    .filter((id): id is string => id !== null && !headIds.has(id))
  return {
    // Who started it decides; a headless resume Seal sends appends `sdk-cli` records to a terminal session.
    headless: str(head.find((r) => str(r.entrypoint))?.entrypoint)?.startsWith('sdk') === true,
    recordIds: [
      ...new Set([...headIds, ...tail.map((r) => str(r.uuid)).filter((id) => id !== null)])
    ],
    continues: [...(firstParent && !headIds.has(firstParent) ? [firstParent] : []), ...leaves]
  }
}

export type TranscriptEnds = {
  path: string
  head: string | null
  tail: string | null
  tailIsWholeFile: boolean
}

export function summarizeClaudeTranscript(input: TranscriptEnds): TranscriptSummary {
  const head = recordsOf(input.head, false)
  const tail = recordsOf(input.tail, !input.tailIsWholeFile)
  const all = [...head, ...tail]
  const id = basename(input.path).replace(/\.jsonl$/, '')
  let cwd: string | null = null
  let customTitle: string | null = null
  let summary: string | null = null
  for (const record of all) {
    cwd = str(record.cwd) ?? cwd
    if (record.type === 'custom-title') {
      customTitle = str(record.customTitle) ?? customTitle
    } else if (record.type === 'summary') {
      summary = str(record.summary) ?? summary
    }
  }
  const firstPrompt = head
    .map((r) => (r.type === 'user' ? claudePromptText(r) : null))
    .find(Boolean)
  const timed = all.map(timeOf).filter((t): t is number => t !== null)
  return {
    ...claudeIdentity(head, tail),
    provider: 'claude',
    providerSessionId: id,
    cwd,
    title: customTitle ?? summary ?? (firstPrompt ? oneLine(firstPrompt, 80) : null),
    ...(customTitle ? { titleNamed: true as const } : {}),
    ...claudePhase(tail.length > 0 ? tail : head),
    firstAt: head.map(timeOf).find((t) => t !== null) ?? null,
    lastAt: timed.length > 0 ? Math.max(...timed) : null,
    parentSessionId: null,
    agentName: null,
    agentType: null
  }
}

function codexPromptText(record: TranscriptRecord): string | null {
  const text = codexUserMessageText(record)?.trim()
  return text && !text.startsWith('<') ? text : null
}

export function summarizeCodexRollout(input: TranscriptEnds): TranscriptSummary {
  const head = recordsOf(input.head, false)
  const tail = recordsOf(input.tail, !input.tailIsWholeFile)
  const all = [...head, ...tail]
  let id = UUID.exec(basename(input.path))?.[1] ?? basename(input.path)
  let cwd: string | null = null
  let headless: boolean | null = null
  let spawn: TranscriptRecord | null = null
  let meta: TranscriptRecord | null = null
  for (const record of all) {
    const payload = rec(record.payload)
    if (record.type === 'session_meta') {
      headless ??= payload?.source === 'exec' || payload?.originator === 'codex_exec'
      id = str(payload?.id) ?? id
      cwd = str(payload?.cwd) ?? cwd
      meta ??= payload
      spawn ??= rec(rec(rec(payload?.source)?.subagent)?.thread_spawn)
    } else if (record.type === 'turn_context') {
      cwd = str(payload?.cwd) ?? cwd
    }
  }
  const firstPrompt = all.map(codexPromptText).find(Boolean)
  const timed = all.map(timeOf).filter((t): t is number => t !== null)
  return {
    headless: headless === true,
    recordIds: [],
    continues: [],
    provider: 'codex',
    providerSessionId: id,
    cwd,
    title: firstPrompt ? oneLine(firstPrompt, 80) : null,
    ...codexPhase(tail.length > 0 ? tail : head),
    firstAt: head.map(timeOf).find((t) => t !== null) ?? null,
    lastAt: timed.length > 0 ? Math.max(...timed) : null,
    parentSessionId: str(spawn?.parent_thread_id) ?? str(meta?.parent_thread_id),
    agentName: str(spawn?.agent_nickname) ?? str(meta?.agent_nickname),
    agentType: str(spawn?.agent_role) ?? str(spawn?.agent_type) ?? str(meta?.agent_role)
  }
}
