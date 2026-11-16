import { ORCA_CLAUDE_CHAT_ENTRYPOINT } from '../../../shared/agent-launch/startup/claude-chat-entrypoint'
import { contextUsageOfRecords } from '../../../shared/live-sessions/adapters/agent-session-context-samples'
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { isContextUsageMeasured } from '../../../shared/native-chat/native-chat-context-usage-state'
import type { NativeChatContextUsageSummary } from '../../../shared/native-chat/native-chat-context-usage-summary'
import { liveSessionAdapter } from '../adapters/live-session-adapters'
import { codexUserMessageText } from './codex-user-message'
import { claudePhase, claudePromptText } from './claude-transcript-phase'
import { codexPhase } from './codex-transcript-phase'
import { basename, oneLine, rec, recordsOf, str, timeOf } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'
import type { ReplyAsk } from './reply-ask'

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

/**
 * A pending call the process list can read further: a `shell` command shows as a process while it
 * runs, and an `edit` is instant, so either one standing with nothing running waits on an approval.
 * A `shell-wait` resumes a command started by an earlier call (Codex's `wait` on a yielded cell).
 */
export type PendingCallKind = 'shell' | 'edit' | 'shell-wait'

export type TranscriptTurn = {
  phase: TranscriptPhase
  /** The tool or error behind `phase`, one line. */
  detail: string | null
  /** The tool a `tool-pending` phase waits on. */
  pendingTool: string | null
  pendingKind: PendingCallKind | null
  /** When the pending call was made (epoch ms, host clock). */
  pendingSince: number | null
  /** Whether the reply that ended the turn asks the user something. */
  replyAsk: ReplyAsk
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
  /**
   * How it asks before acting: Claude's permission mode (`default`, `acceptEdits`, `auto`,
   * `bypassPermissions`, `plan`) or Codex's approval policy (`on-request`, `never`, …).
   */
  approvalMode: string | null
  /** How full its context window is, as far as the bytes read say; null for an agent that records no usage. */
  context: NativeChatContextUsageSummary | null
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
  pendingKind: null,
  pendingSince: null,
  replyAsk: 'tells',
  settled: false,
  lastMessage: null
}

/** Compactions are counted only when the tail is the whole file. */
function contextOf(
  provider: LiveSessionProvider,
  records: TranscriptRecord[],
  whole: boolean
): NativeChatContextUsageSummary | null {
  const decoder = liveSessionAdapter(provider)?.transcript?.decoder ?? null
  return contextUsageOfRecords(decoder, records, { complete: whole })
}

/**
 * A tail with no response in it says nothing new: the last reading stands until a response or a
 * compaction replaces it. A new reading keeps what only records before its tail said: the model
 * its turn began under, and a window that model was already seen to exceed. `sized` is the last
 * reading that had a size, which a compaction read on its own leaves `earlier` without.
 */
export function contextAfter(
  read: NativeChatContextUsageSummary | null,
  earlier: NativeChatContextUsageSummary | null,
  sized: NativeChatContextUsageSummary | null = earlier
): NativeChatContextUsageSummary | null {
  if (!earlier || !read) {
    return read ?? earlier
  }
  const model = read.model ?? earlier.model
  if (!isContextUsageMeasured(read)) {
    if (read.lastCompactedAt === undefined) {
      return earlier
    }
    return model === undefined ? read : { ...read, model }
  }
  const proof = isContextUsageMeasured(earlier) ? earlier : sized
  const held = read.estimated && proof?.estimated === true && model === proof.model
  const windowTokens = held ? Math.max(read.windowTokens, proof.windowTokens) : read.windowTokens
  return {
    ...read,
    ...(model === undefined ? {} : { model }),
    windowTokens,
    percentage:
      windowTokens === read.windowTokens
        ? read.percentage
        : Math.round((read.usedTokens / windowTokens) * 100)
  }
}

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/** Claude Code started by a program: the Agent SDK, `claude -p`, or a Seal chat. */
function isDrivenEntrypoint(entrypoint: string | null): boolean {
  return entrypoint?.startsWith('sdk') === true || entrypoint === ORCA_CLAUDE_CHAT_ENTRYPOINT
}

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
  const writers = [...head, ...tail].flatMap((r) => str(r.entrypoint) ?? [])
  return {
    // A terminal that wrote any of it makes it that terminal's: a headless resume Seal sends
    // appends `sdk-cli` records, and a fork into the CLI opens with a chat's history.
    headless: writers.length > 0 && writers.every(isDrivenEntrypoint),
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
  let approvalMode: string | null = null
  for (const record of all) {
    cwd = str(record.cwd) ?? cwd
    if (record.type === 'custom-title') {
      customTitle = str(record.customTitle) ?? customTitle
    } else if (record.type === 'summary') {
      summary = str(record.summary) ?? summary
    } else if (record.type === 'permission-mode') {
      approvalMode = str(record.permissionMode) ?? approvalMode
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
    approvalMode,
    context: contextOf('claude', tail.length > 0 ? tail : head, input.tailIsWholeFile),
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
  let approvalMode: string | null = null
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
      approvalMode = str(payload?.approval_policy) ?? approvalMode
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
    approvalMode,
    context: contextOf('codex', tail.length > 0 ? tail : head, input.tailIsWholeFile),
    firstAt: head.map(timeOf).find((t) => t !== null) ?? null,
    lastAt: timed.length > 0 ? Math.max(...timed) : null,
    parentSessionId: str(spawn?.parent_thread_id) ?? str(meta?.parent_thread_id),
    agentName: str(spawn?.agent_nickname) ?? str(meta?.agent_nickname),
    agentType: str(spawn?.agent_role) ?? str(spawn?.agent_type) ?? str(meta?.agent_role)
  }
}
