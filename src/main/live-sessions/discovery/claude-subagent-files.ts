// A Claude Code subagent writes its own transcript beside its session's:
// `<session>/subagents/agent-<id>.jsonl`, with `agent-<id>.meta.json` describing how it was started.
import { parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'
import {
  basename,
  blocks,
  contentText,
  oneLine,
  rec,
  recordsOf,
  str,
  timeOf,
  toolLabel
} from './transcript-records'

/** One subagent transcript as a scan found it; `meta` and `tail` are null when not read this time. */
export type DiscoveredSubagentFile = {
  path: string
  size: number
  mtimeMs: number
  meta: string | null
  tail: string | null
}

export type SubagentFileSummary = {
  agentId: string
  path: string
  size: number
  mtimeMs: number
  /** The parent's Agent tool call that started it. */
  toolUseId: string | null
  title: string | null
  agentType: string | null
  model: string | null
  background: boolean | null
  /** Its meta file or its last record says it is over. */
  finished: boolean
  /** Its last record leaves a prompt or tool call unanswered. */
  midTurn: boolean
  activity: string | null
  lastAt: number | null
}

/** Where a session's subagent transcripts live, given the session's own transcript. */
export function claudeSubagentsDir(transcriptPath: string): string {
  return `${transcriptPath.replace(/\.jsonl$/, '')}/subagents`
}

export function subagentIdOfPath(path: string): string | null {
  return /^agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(basename(path))?.[1] ?? null
}

function tailFacts(
  tail: string | null,
  whole: boolean
): Pick<SubagentFileSummary, 'finished' | 'midTurn' | 'activity' | 'lastAt' | 'title'> {
  const records = recordsOf(tail, !whole)
  let finished = false
  let midTurn = false
  let activity: string | null = null
  let lastAt: number | null = null
  let title: string | null = null
  for (const record of records) {
    lastAt = timeOf(record) ?? lastAt
    const content = rec(record.message)?.content
    if (record.type === 'attachment') {
      finished ||= rec(record.attachment)?.hookEvent === 'SubagentStop'
    } else if (record.type === 'assistant') {
      const tool = blocks(content).findLast((b) => b.type === 'tool_use')
      const text = contentText(content).trim()
      midTurn = tool !== undefined
      activity = tool
        ? toolLabel(str(tool.name) ?? 'Tool', rec(tool.input))
        : text
          ? oneLine(text, 120)
          : activity
    } else if (record.type === 'user') {
      midTurn = true
      if (whole && title === null && typeof content === 'string') {
        title = oneLine(content, 100)
      }
    }
  }
  return { finished, midTurn, activity, lastAt, title }
}

export function summarizeSubagentFile(
  file: DiscoveredSubagentFile,
  tailBytes: number,
  previous?: SubagentFileSummary
): SubagentFileSummary | null {
  const agentId = subagentIdOfPath(file.path)
  if (!agentId) {
    return null
  }
  const meta = file.meta ? parseJsonRecord(file.meta) : null
  // A re-read replaces what the old bytes said: a finished subagent can be sent on again.
  const facts = file.tail === null ? previous : tailFacts(file.tail, file.size <= tailBytes)
  return {
    agentId,
    path: file.path,
    size: file.size,
    mtimeMs: file.mtimeMs,
    toolUseId: str(meta?.toolUseId) ?? previous?.toolUseId ?? null,
    title: str(meta?.description) ?? previous?.title ?? facts?.title ?? null,
    agentType: str(meta?.agentType) ?? previous?.agentType ?? null,
    model: str(meta?.model) ?? previous?.model ?? null,
    background: meta
      ? meta.requestShape === 'background' || meta.isAsync === true
      : (previous?.background ?? null),
    finished: meta ? meta.finished === true || facts?.finished === true : facts?.finished === true,
    midTurn: facts?.midTurn ?? false,
    activity: facts?.activity ?? previous?.activity ?? null,
    lastAt: facts?.lastAt ?? previous?.lastAt ?? null
  }
}
