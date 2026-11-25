// A Claude Code session on another machine's account: a `claude` process there plus its transcript
// under that account's home, as a registry scan over SSH or through a Seal server finds one.
import { randomUUID } from 'node:crypto'
import type { LocalSshdUser } from './local-sshd-machines'

export type RemoteClaudeSession = {
  providerSessionId: string
  cwd: string
  transcriptPath: string
  pid: number
  /** The user sends a prompt: the session reads as `working`. */
  submitPrompt: (text: string) => void
  /** Claude edits a file mid-turn: still `working`, and the recap gains a file reference. */
  editFile: (filePath: string) => void
  /** Claude ends its turn on this message: `your-turn`. */
  finishTurn: (text: string) => void
  /** Ends the process: the session stops being alive on the next scan. */
  stop: () => void
}

const LIFETIME_SECONDS = 1_800

const shQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

/**
 * Starts the session with no turn yet, everything as the account itself. Records are the ones
 * Claude Code 2.1 writes (and `claudeScenarioTranscript` replays), stamped with the real time.
 */
export function seedRemoteClaudeSession(
  user: LocalSshdUser,
  options: { project?: string } = {}
): RemoteClaudeSession {
  const providerSessionId = randomUUID()
  const cwd = `${user.home}/projects/${options.project ?? 'shop'}`
  const transcriptDir = `${user.home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`
  const transcriptPath = `${transcriptDir}/${providerSessionId}.jsonl`
  const title = `claude --resume ${providerSessionId}`
  user.sh(`mkdir -p ${shQuote(cwd)} ${shQuote(transcriptDir)}`)
  // `ps` on that machine must show `claude --resume <id>`; the sleep bounds a process a crashed test leaves.
  user.sh(
    `cd ${shQuote(cwd)} && nohup perl -e '$0 = shift; sleep ${LIFETIME_SECONDS}' ${shQuote(title)} </dev/null >/dev/null 2>&1 &`
  )
  const pid = Number(
    user
      .sh(`pgrep -u "$(id -u)" -f ${shQuote(`^${title}$`)} | head -n 1`)
      .toString()
      .trim()
  )
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`The stand-in claude process did not start as ${user.username}`)
  }

  let parentUuid: string | null = null
  const append = (record: Record<string, unknown>): void => {
    const uuid = randomUUID()
    user.sh(
      `cat >> ${shQuote(transcriptPath)}`,
      `${JSON.stringify({
        parentUuid,
        isSidechain: false,
        userType: 'external',
        cwd,
        sessionId: providerSessionId,
        version: '2.1.325',
        gitBranch: 'main',
        uuid,
        timestamp: new Date().toISOString(),
        ...record
      })}\n`
    )
    parentUuid = uuid
  }
  const assistant = (content: unknown[], stopReason: string | null): void =>
    append({
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

  return {
    providerSessionId,
    cwd,
    transcriptPath,
    pid,
    submitPrompt: (text) => append({ type: 'user', message: { role: 'user', content: text } }),
    editFile: (filePath) => {
      const id = `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`
      assistant(
        [
          {
            type: 'tool_use',
            id,
            name: 'Edit',
            input: { file_path: filePath, old_string: 'before', new_string: 'after' }
          }
        ],
        'tool_use'
      )
      append({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: id,
              type: 'tool_result',
              content: `The file ${filePath} has been updated.`
            }
          ]
        },
        toolUseResult: {
          filePath,
          structuredPatch: [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+after'] }
          ]
        }
      })
    },
    finishTurn: (text) => {
      assistant([{ type: 'text', text }], 'end_turn')
      // Claude's own end-of-turn record: without it a fresh reply reads as still streaming for 5 s.
      append({ type: 'system', subtype: 'turn_duration', durationMs: 1_200, isMeta: false })
    },
    stop: () => {
      user.sh(`kill -KILL ${pid} 2>/dev/null; true`)
    }
  }
}
