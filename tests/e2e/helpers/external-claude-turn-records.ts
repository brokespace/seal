// What a Claude Code turn writes before it ends, for a session `seedExternalClaudeSession` made:
// the agent's own words mid-turn and tool calls that already have their result.
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import type { ExternalClaudeSession } from './external-claude-session'

function lastRecordUuid(transcriptPath: string): string | null {
  const last = readFileSync(transcriptPath, 'utf8').trimEnd().split('\n').at(-1)
  return last ? (JSON.parse(last).uuid ?? null) : null
}

function append(session: ExternalClaudeSession, record: Record<string, unknown>): void {
  appendFileSync(
    session.transcriptPath,
    `${JSON.stringify({
      parentUuid: lastRecordUuid(session.transcriptPath),
      isSidechain: false,
      userType: 'external',
      cwd: session.cwd,
      sessionId: session.providerSessionId,
      version: '2.1.325',
      gitBranch: 'main',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      ...record
    })}\n`
  )
}

function assistant(
  session: ExternalClaudeSession,
  content: unknown[],
  stopReason: string | null
): void {
  append(session, {
    type: 'assistant',
    message: {
      id: `msg_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content,
      stop_reason: stopReason
    }
  })
}

/** Claude says something and goes on working: the next record must be a tool call. */
export function sayMidTurn(session: ExternalClaudeSession, text: string): void {
  assistant(session, [{ type: 'text', text }], null)
}

/**
 * A tool call with its result: the session stays `working`. The seeded session's own `runTool`
 * leaves the call open, which reads as a permission prompt once it is five seconds old.
 */
export function finishToolCall(
  session: ExternalClaudeSession,
  name: string,
  input: Record<string, unknown>,
  output: string,
  toolUseResult?: Record<string, unknown>
): void {
  const id = `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`
  assistant(session, [{ type: 'tool_use', id, name, input }], 'tool_use')
  append(session, {
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: output }] },
    ...(toolUseResult ? { toolUseResult } : {})
  })
}

/** Claude edits a file, as its Edit tool records it. */
export function finishEdit(session: ExternalClaudeSession, filePath: string): void {
  finishToolCall(
    session,
    'Edit',
    { file_path: filePath, old_string: 'before', new_string: 'after' },
    `The file ${filePath} has been updated.`,
    {
      filePath,
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+after'] }
      ]
    }
  )
}
