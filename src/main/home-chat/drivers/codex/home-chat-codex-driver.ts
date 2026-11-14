import { randomUUID } from 'node:crypto'
import { estimateItemsTokens, estimateTextTokens } from '../../engine/home-chat-compaction'
import { seededPrompt } from '../../engine/home-chat-session-seed'
import {
  modelTextForUserItem,
  SUMMARY_REQUEST,
  systemNote
} from '../../engine/home-chat-system-note'
import { processEnvWithoutAgentSession } from '../../../../shared/agent-launch/startup/parent-agent-session-env'
import { spawnSourceControlAgent } from '../../../text-generation/execution/source-control-agent-launch'
import { killSourceControlAgentProcess } from '../../../text-generation/execution/source-control-agent-termination'
import { activeItems } from '../../thread/home-chat-thread-history'
import type { HomeChatDriver, HomeChatDriverTurn } from '../home-chat-driver'
import { missedItems, resumableSession } from '../home-chat-provider-session'
import { claimToolCall } from '../home-chat-tool-call-claims'
import { CodexExecEvents, SEAL_MCP_SERVER_NAME } from './codex-exec-events'
import {
  openSealMcpEndpoint,
  SEAL_MCP_TOKEN_ENV,
  type SealMcpEndpoint
} from './seal-mcp-http-endpoint'

// Approval cards and long builds hold a tool call open far past Codex's default MCP timeout.
const TOOL_TIMEOUT_SEC = 24 * 60 * 60
const CONTEXT_WINDOW = 272_000
/** Windows caps a whole command line near 32k characters. */
const MAX_WINDOWS_INSTRUCTION_ARG = 16_000
const MAX_STDERR_CHARS = 4_000

export type HomeChatCodexDriverOptions = {
  /** Stable across turns, and nothing Codex could mistake for a project. */
  cwd: string
  /** CODEX_HOME of the chosen account; null runs on the default login. */
  codexHome: string | null
  model: string | null
}

type CodexRun = {
  prompt: string
  systemPrompt: string
  resume: string | null
  ephemeral?: boolean
  signal: AbortSignal
  events: CodexExecEvents
  endpoint?: SealMcpEndpoint
}

/** `-c key=value` takes TOML; a JSON string is a valid TOML basic string. */
function config(key: string, value: string | number): string[] {
  return ['-c', `${key}=${typeof value === 'number' ? value : JSON.stringify(value)}`]
}

function execArgs(
  options: HomeChatCodexDriverOptions,
  run: CodexRun,
  instructions: boolean
): string[] {
  const server = `mcp_servers.${SEAL_MCP_SERVER_NAME}`
  return [
    'exec',
    ...(run.resume ? ['resume'] : []),
    '--json',
    '--skip-git-repo-check',
    ...(run.ephemeral ? ['--ephemeral'] : []),
    // Seal's tools act on machines; Codex's own shell stays read-only on this computer.
    ...config('sandbox_mode', 'read-only'),
    ...(instructions ? config('developer_instructions', run.systemPrompt) : []),
    ...(run.endpoint
      ? [
          ...config(`${server}.url`, run.endpoint.url),
          ...config(`${server}.bearer_token_env_var`, SEAL_MCP_TOKEN_ENV),
          ...config(`${server}.tool_timeout_sec`, TOOL_TIMEOUT_SEC),
          // Seal asks the user itself before a risky tool runs.
          ...config(`${server}.default_tools_approval_mode`, 'approve')
        ]
      : []),
    ...(options.model ? ['-m', options.model] : []),
    ...(run.resume ? [run.resume] : []),
    // The prompt arrives on stdin: no argument size limit, no shell quoting.
    '-'
  ]
}

/** One `codex exec` process for one prompt: started here, gone when this returns. */
async function runCodex(options: HomeChatCodexDriverOptions, run: CodexRun): Promise<void> {
  const instructionsInArgs =
    process.platform !== 'win32' || run.systemPrompt.length <= MAX_WINDOWS_INSTRUCTION_ARG
  // When the instructions cannot ride in the arguments, a new session reads them once up front.
  const prompt =
    instructionsInArgs || run.resume
      ? run.prompt
      : `${systemNote(`Standing instructions for this conversation:\n\n${run.systemPrompt}`)}\n\n${run.prompt}`
  const child = spawnSourceControlAgent({
    binary: 'codex',
    args: execArgs(options, run, instructionsInArgs),
    cwd: options.cwd,
    env: {
      ...processEnvWithoutAgentSession(),
      ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}),
      ...(run.endpoint ? { [SEAL_MCP_TOKEN_ENV]: run.endpoint.token } : {})
    },
    stdinMode: 'pipe',
    useCwdForNative: true
  })
  let stderr = ''
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => run.events.feed(chunk))
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS)
  })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
  const onAbort = (): void => void killSourceControlAgentProcess(child)
  run.signal.addEventListener('abort', onAbort, { once: true })
  try {
    child.stdin?.on('error', () => {})
    child.stdin?.end(prompt)
    const code = await exited
    run.events.end()
    if (run.signal.aborted) {
      return
    }
    if (run.events.error || code !== 0) {
      throw new Error(
        run.events.error ??
          `Codex exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`
      )
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        'The codex command was not found on this computer. Install Codex CLI, or pick another model source in the assistant settings.'
      )
    }
    throw error
  } finally {
    run.signal.removeEventListener('abort', onAbort)
    // The process never outlives its turn.
    if (child.exitCode === null && child.signalCode === null) {
      await killSourceControlAgentProcess(child)
    }
  }
}

async function runTurn(
  options: HomeChatCodexDriverOptions,
  turn: HomeChatDriverTurn
): Promise<void> {
  const { thread, input, recorder, signal } = turn
  const claimed = new Set<string>()
  const endpoint = await openSealMcpEndpoint(async (name, args) => {
    const callId = await claimToolCall(recorder, claimed, name, args, 'codex_seal')
    const reply = await turn.runTool({ callId, tool: name, input: args })
    return { text: reply.text, isError: reply.outcome !== 'ok' }
  })
  const message = modelTextForUserItem(input)
  const attempt = async (resume: string | null): Promise<void> => {
    const events = new CodexExecEvents(recorder, randomUUID().slice(0, 8))
    try {
      await runCodex(options, {
        prompt: seededPrompt(missedItems(thread, input, resume !== null), message),
        systemPrompt: turn.systemPrompt,
        resume,
        signal,
        events,
        endpoint
      })
    } finally {
      if (events.sessionId && events.sawOutput) {
        turn.confirmSession(events.sessionId)
      }
    }
  }
  try {
    const resume = resumableSession(thread, 'codex')
    if (!resume) {
      await attempt(null)
      return
    }
    try {
      await attempt(resume)
    } catch (error) {
      // A session Codex no longer has fails before it says anything.
      if (signal.aborted || recorder.hasOutput()) {
        throw error
      }
      await attempt(null)
    }
  } finally {
    await endpoint.close()
  }
}

/**
 * The assistant on the user's Codex subscription. Every turn runs one `codex exec`, resumes the
 * thread's session by id, and reaches Seal's tools through an MCP endpoint that lives for that turn.
 */
export function createCodexDriver(options: HomeChatCodexDriverOptions): HomeChatDriver {
  return {
    contextWindow: CONTEXT_WINDOW,
    // Codex reports usage summed over a turn's requests, which is not the context size; estimate.
    contextTokens: (thread, systemPrompt) =>
      estimateTextTokens(systemPrompt) + estimateItemsTokens(activeItems(thread.items)),
    runTurn: (turn) => runTurn(options, turn),
    summarize: async ({ systemPrompt, items, signal }) => {
      const events = new CodexExecEvents(null, 'summary')
      await runCodex(options, {
        prompt: seededPrompt(items, systemNote(SUMMARY_REQUEST)),
        systemPrompt,
        resume: null,
        ephemeral: true,
        signal,
        events
      })
      return events.replyText.trim()
    }
  }
}
