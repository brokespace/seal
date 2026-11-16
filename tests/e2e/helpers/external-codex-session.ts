// A Codex CLI session started outside Seal, as the live-session registry finds one: a `codex`
// process in `ps` plus its rollout under the app's own HOME.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'

export type ExternalCodexSession = {
  /** The id rows and the registry use: `local:codex:<providerSessionId>`. */
  sessionId: string
  providerSessionId: string
  cwd: string
  transcriptPath: string
  pid: number
  /** The user sends a prompt: the session reads as `working`. */
  submitPrompt: (text: string) => void
  /** Codex calls a tool and gets its output: still `working`. */
  runTool: (name: string, input: Record<string, unknown>, output: string) => void
  /**
   * Codex ends its turn on this message: `your-turn`; `waiting-input` when its last line ends in
   * a question mark, or when the reply-ask classifier answers ASKS for it.
   */
  finishTurn: (text: string) => void
  /** Codex stops on its question tool: `waiting-input`. */
  askQuestion: (question: string, options?: string[]) => void
  /** Ends the process: the session stops being alive on the next scan. */
  stop: () => void
}

const LIFETIME_SECONDS = 900

/**
 * Starts the session with no turn yet. Rows need a first `submitPrompt`, whose text is also the
 * session's title. Call `stop()` when the test ends.
 */
export async function seedExternalCodexSession(
  app: ElectronApplication,
  options: { cwd?: string; providerSessionId?: string } = {}
): Promise<ExternalCodexSession> {
  // The app scans its own HOME, which the E2E launch points inside the test's user-data folder.
  const home = await app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
  const providerSessionId = options.providerSessionId ?? randomUUID()
  const cwd = options.cwd ?? path.join(home, 'projects', 'shop')
  mkdirSync(cwd, { recursive: true })
  const started = new Date()
  const [day, time] = started.toISOString().split('T')
  // Codex files a rollout by its start day and names it for its start second and session id.
  const transcriptDir = path.join(home, '.codex', 'sessions', ...day.split('-'))
  mkdirSync(transcriptDir, { recursive: true })
  const transcriptPath = path.join(
    transcriptDir,
    `rollout-${day}T${time.slice(0, 8).replaceAll(':', '-')}-${providerSessionId}.jsonl`
  )

  const append = (type: string, payload: Record<string, unknown>): void =>
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), type, payload })}\n`
    )
  append('session_meta', {
    id: providerSessionId,
    timestamp: started.toISOString(),
    cwd,
    originator: 'codex_cli_rs',
    cli_version: '0.169.0',
    source: 'cli',
    model_provider: 'openai'
  })

  // `ps` must show `codex resume <id>`; the sleep bounds a process a crashed test leaves behind.
  const child: ChildProcess = spawn(
    'perl',
    ['-e', `$0 = shift; sleep ${LIFETIME_SECONDS}`, `codex resume ${providerSessionId}`],
    { cwd, stdio: 'ignore' }
  )
  if (!child.pid) {
    throw new Error('The stand-in codex process did not start (is perl installed?)')
  }

  let calls = 0
  const nextCallId = (): string => `call_${String(++calls).padStart(6, '0')}`

  return {
    sessionId: `local:codex:${providerSessionId}`,
    providerSessionId,
    cwd,
    transcriptPath,
    pid: child.pid,
    submitPrompt: (text) => {
      // The response item is the copy the model saw; the event is the turn the user sent.
      append('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }]
      })
      append('event_msg', { type: 'user_message', message: text, kind: 'plain' })
      append('event_msg', { type: 'task_started', model_context_window: 272_000 })
    },
    runTool: (name, input, output) => {
      const callId = nextCallId()
      append('response_item', {
        type: 'function_call',
        name,
        arguments: JSON.stringify(input),
        call_id: callId
      })
      append('response_item', { type: 'function_call_output', call_id: callId, output })
    },
    finishTurn: (text) => {
      append('event_msg', { type: 'agent_message', message: text })
      append('response_item', {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }]
      })
      append('event_msg', { type: 'task_complete', last_agent_message: text })
    },
    askQuestion: (question, options = ['First option', 'Second option']) =>
      append('response_item', {
        type: 'function_call',
        name: 'request_user_input',
        arguments: JSON.stringify({
          questions: [
            {
              id: 'q1',
              header: 'Choice',
              question,
              options: options.map((label) => ({ label }))
            }
          ]
        }),
        call_id: nextCallId()
      }),
    stop: () => {
      child.kill('SIGKILL')
    }
  }
}
