import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import {
  loadClaudeAgentSdk,
  openClaudeStreamJsonConnection,
  type ClaudeStreamJsonLaunch
} from '../../../claude/claude-stream-json-connection'
import {
  claudeChildEnv,
  resolveClaudeChildEnvSources
} from '../../../claude/structured/launch/claude-structured-child-env'
import { claudeConfigDirEnvPatch } from '../../../claude/structured/launch/claude-config-dir-pin'
import { estimateItemsTokens, estimateTextTokens } from '../../engine/home-chat-compaction'
import { seededPrompt } from '../../engine/home-chat-session-seed'
import {
  modelTextForUserItem,
  SUMMARY_REQUEST,
  systemNote
} from '../../engine/home-chat-system-note'
import type { HomeChatTurnRecorder } from '../../engine/home-chat-turn-recorder'
import { activeItems } from '../../thread/home-chat-thread-history'
import { HOME_CHAT_TOOLS } from '../../tools/home-chat-tool-definitions'
import type { HomeChatToolCall, HomeChatToolReply } from '../../tools/home-chat-tool-runner'
import type { HomeChatDriver, HomeChatDriverTurn } from '../home-chat-driver'
import { missedItems, resumableSession } from '../home-chat-provider-session'
import { claimToolCall } from '../home-chat-tool-call-claims'
import { ClaudeTurnStream, SEAL_MCP_SERVER_NAME } from './claude-turn-stream'

// Approval cards and long builds hold a tool call open far past the CLI's default MCP timeout.
const MCP_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000
const INTERRUPT_GRACE_MS = 5_000
const DEFAULT_CONTEXT_WINDOW = 200_000
const TOOL_USE_ID_META = 'claudecode/toolUseId'

export type HomeChatClaudeDriverOptions = {
  /** Stable across turns: Claude files a session under its working folder. */
  cwd: string
  /** CLAUDE_CONFIG_DIR of the chosen account; null runs on the default login. */
  claudeConfigDir: string | null
  model: string | null
}

type RunTool = (call: HomeChatToolCall) => Promise<HomeChatToolReply>

function toolUseId(extra: unknown): string | null {
  const meta =
    typeof extra === 'object' && extra !== null && '_meta' in extra ? extra._meta : undefined
  const id =
    typeof meta === 'object' && meta !== null && TOOL_USE_ID_META in meta
      ? meta[TOOL_USE_ID_META]
      : undefined
  return typeof id === 'string' ? id : null
}

async function buildSealMcpServer(
  recorder: HomeChatTurnRecorder,
  runTool: RunTool
): Promise<McpSdkServerConfigWithInstance> {
  const { createSdkMcpServer, tool } = await loadClaudeAgentSdk()
  const claimed = new Set<string>()
  const tools = Object.entries(HOME_CHAT_TOOLS).map(([name, spec]) =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Object.entries loses the literal key type of HOME_CHAT_TOOLS.
    tool(name, spec.description, spec.shape as z.ZodRawShape, async (args, extra) => {
      const callId =
        toolUseId(extra) ?? (await claimToolCall(recorder, claimed, name, args, 'toolu_seal'))
      const reply = await runTool({ callId, tool: name, input: args })
      return { content: [{ type: 'text', text: reply.text }], isError: reply.outcome !== 'ok' }
    })
  )
  return createSdkMcpServer({
    name: SEAL_MCP_SERVER_NAME,
    version: '1.0.0',
    tools,
    // Without this Claude hides the tools behind a search step and often never finds them.
    alwaysLoad: true,
    timeout: MCP_TOOL_TIMEOUT_MS
  })
}

type ClaudeRun = {
  prompt: string
  systemPrompt: string
  session: { resume: string } | { sessionId: string } | { ephemeral: true }
  signal: AbortSignal
  stream: ClaudeTurnStream
  mcpServer?: McpSdkServerConfigWithInstance
}

/** One Claude Code process for one prompt: started here, gone when this returns. */
async function runClaude(options: HomeChatClaudeDriverOptions, run: ClaudeRun): Promise<void> {
  const sources = await resolveClaudeChildEnvSources({})
  const env = { ...claudeChildEnv(sources), MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) }
  if (options.claudeConfigDir) {
    Object.assign(env, claudeConfigDirEnvPatch(options.claudeConfigDir, { env }))
  }
  const done = Promise.withResolvers<void>()
  // A fault can settle the run before anything awaits it.
  done.promise.catch(() => undefined)
  const fail = (error: Error): void => done.reject(error)
  const launch: ClaudeStreamJsonLaunch = {
    pathToClaudeCodeExecutable: sources.command,
    prefixArgs: sources.prefixArgs,
    cwd: options.cwd,
    env,
    options: {
      includePartialMessages: true,
      systemPrompt: run.systemPrompt,
      // The assistant's instructions, skills and tools all come from Seal, for every machine alike.
      settingSources: [],
      supportedDialogKinds: [],
      tools: [],
      ...(options.model ? { model: options.model } : {}),
      ...(run.mcpServer
        ? {
            mcpServers: { [SEAL_MCP_SERVER_NAME]: run.mcpServer },
            allowedTools: [`mcp__${SEAL_MCP_SERVER_NAME}`]
          }
        : {}),
      ...('ephemeral' in run.session ? { persistSession: false } : run.session)
    }
  }
  const connection = await openClaudeStreamJsonConnection(launch, {
    onMessage: (message) => {
      const outcome = run.stream.handle(message)
      if (!outcome.done) {
        return
      }
      if (outcome.error && !run.signal.aborted) {
        done.reject(new Error(outcome.error))
      } else {
        done.resolve()
      }
    },
    canUseTool: (toolName) =>
      Promise.resolve({
        behavior: 'deny',
        message: `${toolName} is not available here. Use Seal's tools (run_command, read_file, ...) and name the machine.`
      }),
    onFault: fail,
    onExit: fail
  })
  const onAbort = (): void => {
    void connection.interrupt().catch(() => undefined)
    setTimeout(() => done.resolve(), INTERRUPT_GRACE_MS).unref()
  }
  run.signal.addEventListener('abort', onAbort, { once: true })
  try {
    if (run.signal.aborted) {
      return
    }
    await connection.send({
      type: 'user',
      uuid: randomUUID(),
      message: { role: 'user', content: [{ type: 'text', text: run.prompt }] },
      parent_tool_use_id: null,
      session_id:
        'resume' in run.session
          ? run.session.resume
          : 'sessionId' in run.session
            ? run.session.sessionId
            : ''
    })
    await done.promise
  } finally {
    run.signal.removeEventListener('abort', onAbort)
    // The process never outlives its turn.
    await connection.close()
  }
}

async function runTurn(
  options: HomeChatClaudeDriverOptions,
  turn: HomeChatDriverTurn
): Promise<void> {
  const { thread, input, recorder, signal } = turn
  const mcpServer = await buildSealMcpServer(recorder, turn.runTool)
  const message = modelTextForUserItem(input)
  const attempt = async (resume: string | null): Promise<ClaudeTurnStream> => {
    const stream = new ClaudeTurnStream(recorder)
    const sessionId = resume ?? randomUUID()
    try {
      await runClaude(options, {
        prompt: seededPrompt(missedItems(thread, input, resume !== null), message),
        systemPrompt: turn.systemPrompt,
        session: resume ? { resume } : { sessionId },
        signal,
        stream,
        mcpServer
      })
    } finally {
      if (stream.sawAssistant) {
        turn.confirmSession(stream.sessionId ?? sessionId)
      }
      if (stream.contextTokens !== null) {
        thread.updateMeta({ contextTokens: stream.contextTokens })
      }
    }
    return stream
  }
  const resume = resumableSession(thread, 'claude-code')
  if (!resume) {
    await attempt(null)
    return
  }
  try {
    await attempt(resume)
  } catch (error) {
    // A session Claude no longer has (pruned, other machine) fails before it says anything.
    if (signal.aborted || recorder.hasOutput()) {
      throw error
    }
    await attempt(null)
  }
}

/**
 * The assistant on the user's Claude subscription, through the Claude Agent SDK. Every turn starts
 * its own Claude Code process, resumes the thread's session by id, and closes it when the turn ends.
 */
export function createClaudeDriver(options: HomeChatClaudeDriverOptions): HomeChatDriver {
  return {
    contextWindow: options.model?.includes('[1m]') ? 1_000_000 : DEFAULT_CONTEXT_WINDOW,
    contextTokens: (thread, systemPrompt) =>
      thread.meta.contextTokens ??
      estimateTextTokens(systemPrompt) + estimateItemsTokens(activeItems(thread.items)),
    runTurn: (turn) => runTurn(options, turn),
    summarize: async ({ systemPrompt, items, signal }) => {
      const stream = new ClaudeTurnStream(null)
      await runClaude(options, {
        prompt: seededPrompt(items, systemNote(SUMMARY_REQUEST)),
        systemPrompt,
        session: { ephemeral: true },
        signal,
        stream
      })
      return stream.replyText.trim()
    }
  }
}
