// A Claude Code session started outside Seal, as the live-session registry finds one: a `claude`
// process in `ps` plus its transcript under the app's own HOME.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'

export type ExternalClaudeSession = {
  /** The id rows and the registry use: `local:claude:<providerSessionId>`. */
  sessionId: string
  providerSessionId: string
  cwd: string
  transcriptPath: string
  pid: number
  /** The user sends a prompt: the session reads as `working`. */
  submitPrompt: (text: string) => void
  /** Claude is mid-turn on a tool call: still `working`. */
  runTool: (command: string) => void
  /**
   * Claude ends its turn on this message: `your-turn`; `waiting-input` when its last line ends in
   * a question mark, or when the reply-ask classifier answers ASKS for it.
   */
  finishTurn: (text: string) => void
  /** Claude stops on its question tool: `waiting-input`. */
  askQuestion: (question: string) => void
  /** Ends the process: the session stops being alive on the next scan. */
  stop: () => void
}

/**
 * A closing message that exercises every session service: longer than 80 characters, so its
 * summary is asked of the model (a shorter one is shown as it is); it names a pull request, so the
 * recap gains a reference; and it reads as a plain statement, so the turn settles on `your-turn`.
 */
export const FINISHED_TURN_REPLY =
  'I traced the loop to the session check running before the cookie was read, moved it after, and added a regression test. Details are in https://github.com/acme/app/pull/42 for review.'

/**
 * A closing message that asks without a question mark: only the reply-ask classifier can tell, and
 * the scripted one answers ASKS for its "should I go ahead". The turn settles on `waiting-input`.
 */
export const ASKING_TURN_REPLY =
  'I looked at both ways to fix the redirect loop, moving the session check or caching the cookie. Tell me which one you want and should I go ahead'

const LIFETIME_SECONDS = 900

/**
 * Starts the session with no turn yet. Rows need a first `submitPrompt`, whose text is also the
 * session's title. Call `stop()` when the test ends.
 */
export async function seedExternalClaudeSession(
  app: ElectronApplication,
  options: { cwd?: string; providerSessionId?: string } = {}
): Promise<ExternalClaudeSession> {
  // The app scans its own HOME, which the E2E launch points inside the test's user-data folder.
  const home = await app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
  const providerSessionId = options.providerSessionId ?? randomUUID()
  const cwd = options.cwd ?? path.join(home, 'projects', 'login-app')
  mkdirSync(cwd, { recursive: true })
  const transcriptDir = path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(transcriptDir, { recursive: true })
  const transcriptPath = path.join(transcriptDir, `${providerSessionId}.jsonl`)

  // `ps` must show `claude --resume <id>`; the sleep bounds a process a crashed test leaves behind.
  const child: ChildProcess = spawn(
    'perl',
    ['-e', `$0 = shift; sleep ${LIFETIME_SECONDS}`, `claude --resume ${providerSessionId}`],
    { cwd, stdio: 'ignore' }
  )
  if (!child.pid) {
    throw new Error('The stand-in claude process did not start (is perl installed?)')
  }

  let parentUuid: string | null = null
  const append = (record: Record<string, unknown>): void => {
    const uuid = randomUUID()
    appendFileSync(
      transcriptPath,
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
  const toolUse = (name: string, input: Record<string, unknown>): void =>
    assistant(
      [
        {
          type: 'tool_use',
          id: `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
          name,
          input
        }
      ],
      null
    )

  return {
    sessionId: `local:claude:${providerSessionId}`,
    providerSessionId,
    cwd,
    transcriptPath,
    pid: child.pid,
    submitPrompt: (text) => append({ type: 'user', message: { role: 'user', content: text } }),
    runTool: (command) => toolUse('Bash', { command, description: command }),
    finishTurn: (text) => {
      assistant([{ type: 'text', text }], 'end_turn')
      // Claude's own end-of-turn record: without it a fresh reply reads as still streaming for 5 s.
      append({ type: 'system', subtype: 'turn_duration', durationMs: 1_200, isMeta: false })
    },
    askQuestion: (question) =>
      toolUse('AskUserQuestion', {
        questions: [
          {
            question,
            header: 'Choice',
            options: [
              { label: 'First option', description: 'The first choice' },
              { label: 'Second option', description: 'The second choice' }
            ],
            multiSelect: false
          }
        ]
      }),
    stop: () => {
      child.kill('SIGKILL')
    }
  }
}
