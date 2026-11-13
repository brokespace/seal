import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { isJsonRecord, parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'
import { codexUserMessageText } from './codex-user-message'

/** What the transcript alone says; liveness, hooks and the screen refine it later. */
export type TranscriptPhase =
  /** A prompt or tool result is being worked on. */
  | 'working'
  /** A tool call has no result yet: running, or waiting on an approval only the screen can tell. */
  | 'tool-pending'
  | 'approval-requested'
  /** The turn ended; the agent waits for the user. */
  | 'turn-ended'
  | 'errored'
  | 'unknown'

export type TranscriptSummary = {
  provider: LiveSessionProvider
  providerSessionId: string
  cwd: string | null
  title: string | null
  phase: TranscriptPhase
  /** The tool or error behind `phase`, one line. */
  detail: string | null
  firstAt: number | null
  lastAt: number | null
  /** Another program drives it (`claude -p`, an Agent SDK host such as Seal's Home chat, `codex exec`). */
  headless: boolean
  /** Record ids seen in the head and tail, for linking a resumed copy to what it continues. */
  recordIds: string[]
  /** Record ids this file says it continues from: a parent it does not hold, a summary's leaf. */
  continues: string[]
}

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function recordsOf(text: string | null, dropFirstPartial: boolean): Record<string, unknown>[] {
  if (!text) {
    return []
  }
  const lines = text.split('\n')
  if (dropFirstPartial) {
    lines.shift()
  }
  const out: Record<string, unknown>[] = []
  for (const line of lines) {
    if (!line.startsWith('{')) {
      continue
    }
    // A cut-off last line parses to null; the next scan reads it whole.
    const record = parseJsonRecord(line)
    if (record) {
      out.push(record)
    }
  }
  return out
}

function rec(value: unknown): Record<string, unknown> | null {
  return isJsonRecord(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function timeOf(record: Record<string, unknown>): number | null {
  const at = str(record.timestamp)
  const ms = at ? Date.parse(at) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

export function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

function blocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.map(rec).filter((b) => b !== null) : []
}

/** A prompt the user typed, not a command echo, hook text or tool result. */
function claudePromptText(record: Record<string, unknown>): string | null {
  if (record.isMeta === true || record.isSidechain === true) {
    return null
  }
  const content = rec(record.message)?.content
  const text =
    typeof content === 'string'
      ? content
      : blocks(content)
          .filter((b) => b.type === 'text')
          .map((b) => str(b.text) ?? '')
          .join('\n')
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('[Request interrupted')) {
    return null
  }
  return trimmed
}

function toolLabel(name: string, input: Record<string, unknown> | null): string {
  const target =
    str(input?.description) ??
    str(input?.command) ??
    (str(input?.file_path) ? basename(str(input?.file_path)!) : null) ??
    str(input?.pattern) ??
    str(input?.url)
  return target ? oneLine(`${name}: ${target}`, 80) : name
}

function claudePhase(
  records: Record<string, unknown>[]
): Pick<TranscriptSummary, 'phase' | 'detail'> {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    if (record.isSidechain === true) {
      continue
    }
    if (record.type === 'system') {
      if (record.subtype === 'api_error' || record.level === 'error') {
        return { phase: 'errored', detail: oneLine(str(record.content) ?? 'API error') }
      }
      if (record.subtype === 'turn_duration' || record.subtype === 'stop_hook_summary') {
        return { phase: 'turn-ended', detail: null }
      }
      continue
    }
    const message = rec(record.message)
    if (record.type === 'assistant') {
      if (record.isApiErrorMessage === true || record.error) {
        const text = blocks(message?.content).find((b) => b.type === 'text')
        return { phase: 'errored', detail: oneLine(str(text?.text) ?? 'API error') }
      }
      const tool = blocks(message?.content).findLast((b) => b.type === 'tool_use')
      if (tool) {
        return {
          phase: 'tool-pending',
          detail: toolLabel(str(tool.name) ?? 'Tool', rec(tool.input))
        }
      }
      if (blocks(message?.content).some((b) => b.type === 'text')) {
        return { phase: 'turn-ended', detail: null }
      }
      return { phase: 'working', detail: 'Thinking' }
    }
    if (record.type === 'user') {
      const content = message?.content
      const text = typeof content === 'string' ? content : ''
      if (
        text.startsWith('[Request interrupted') ||
        blocks(content).some((b) => str(b.text)?.startsWith('[Request interrupted'))
      ) {
        return { phase: 'turn-ended', detail: 'Interrupted' }
      }
      if (
        record.isMeta === true ||
        text.startsWith('<local-command') ||
        text.startsWith('<command-name>')
      ) {
        continue
      }
      return { phase: 'working', detail: 'Thinking' }
    }
  }
  return { phase: 'unknown', detail: null }
}

function claudeIdentity(
  head: Record<string, unknown>[],
  tail: Record<string, unknown>[]
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

export function summarizeClaudeTranscript(input: {
  path: string
  head: string | null
  tail: string | null
  tailIsWholeFile: boolean
}): TranscriptSummary {
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
    ...claudePhase(tail.length > 0 ? tail : head),
    firstAt: head.map(timeOf).find((t) => t !== null) ?? null,
    lastAt: timed.length > 0 ? Math.max(...timed) : null
  }
}

const CODEX_WORKING = new Set([
  'task_started',
  'user_message',
  'agent_reasoning',
  'agent_reasoning_delta',
  'exec_command_begin',
  'exec_command_end',
  'patch_apply_begin',
  'patch_apply_end',
  'mcp_tool_call_begin',
  'mcp_tool_call_end',
  'web_search_begin',
  'web_search_end'
])

function codexPhase(
  records: Record<string, unknown>[]
): Pick<TranscriptSummary, 'phase' | 'detail'> {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    const payload = rec(record.payload)
    const kind = str(payload?.type)
    if (record.type !== 'event_msg' || !kind) {
      continue
    }
    if (kind === 'task_complete' || kind === 'turn_aborted') {
      return { phase: 'turn-ended', detail: kind === 'turn_aborted' ? 'Interrupted' : null }
    }
    if (kind === 'error' || kind === 'stream_error') {
      return { phase: 'errored', detail: oneLine(str(payload?.message) ?? 'Error') }
    }
    if (kind === 'exec_approval_request' || kind === 'apply_patch_approval_request') {
      const command = Array.isArray(payload?.command) ? payload.command.join(' ') : null
      return {
        phase: 'approval-requested',
        detail: command ? oneLine(`Allow ${command}?`, 80) : 'Allow edit?'
      }
    }
    if (kind === 'exec_command_begin') {
      const command = Array.isArray(payload?.command) ? payload.command.join(' ') : 'command'
      return { phase: 'tool-pending', detail: oneLine(`Bash: ${command}`, 80) }
    }
    if (CODEX_WORKING.has(kind) || codexUserMessageText(record) !== null) {
      return { phase: 'working', detail: 'Thinking' }
    }
  }
  return { phase: 'unknown', detail: null }
}

function codexPromptText(record: Record<string, unknown>): string | null {
  const text = codexUserMessageText(record)?.trim()
  return text && !text.startsWith('<') ? text : null
}

export function summarizeCodexRollout(input: {
  path: string
  head: string | null
  tail: string | null
  tailIsWholeFile: boolean
}): TranscriptSummary {
  const head = recordsOf(input.head, false)
  const tail = recordsOf(input.tail, !input.tailIsWholeFile)
  const all = [...head, ...tail]
  let id = UUID.exec(basename(input.path))?.[1] ?? basename(input.path)
  let cwd: string | null = null
  let headless: boolean | null = null
  for (const record of all) {
    const payload = rec(record.payload)
    if (record.type === 'session_meta') {
      headless ??= payload?.source === 'exec' || payload?.originator === 'codex_exec'
      id = str(payload?.id) ?? id
      cwd = str(payload?.cwd) ?? cwd
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
    lastAt: timed.length > 0 ? Math.max(...timed) : null
  }
}
