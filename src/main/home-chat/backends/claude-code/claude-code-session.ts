import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import {
  loadClaudeAgentSdk,
  openClaudeStreamJsonConnection,
  type ClaudeStreamJsonConnection
} from '../../../claude/claude-stream-json-connection'
import {
  claudeChildEnv,
  resolveClaudeChildEnvSources
} from '../../../claude/structured/launch/claude-structured-child-env'
import { claudeConfigDirEnvPatch } from '../../../claude/structured/launch/claude-config-dir-pin'
import { HOME_CHAT_TOOLS, type HomeChatToolName } from '../../tools/home-chat-tool-definitions'
import type { HomeChatBackendSession, HomeChatTurnContext } from '../home-chat-backend'
import { ClaudeStreamTranslator, SEAL_MCP_SERVER_NAME } from './claude-stream-translator'

// Seal's tools replace Claude's local file and shell tools so every action names its machine.
const DISALLOWED_BUILTIN_TOOLS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'Read',
  'Glob',
  'Grep',
  'LS',
  'Task',
  'Agent'
]
// Approval cards and long builds hold a tool call open far past the CLI's default MCP timeout.
const MCP_TOOL_TIMEOUT_MS = String(24 * 60 * 60 * 1000)

export type ClaudeCodeSessionOptions = {
  cwd: string
  /** CLAUDE_CONFIG_DIR of the chosen account; null runs on the default login. */
  claudeConfigDir: string | null
  /** Resume this Claude session id when the chat already has one. */
  resumeSessionId: string | null
  onSessionId: (sessionId: string) => void
}

type ActiveTurn = {
  ctx: HomeChatTurnContext
  translator: ClaudeStreamTranslator
  done: PromiseWithResolvers<void>
}

async function buildSealMcpServer(
  runTool: (tool: HomeChatToolName, args: unknown) => Promise<{ text: string; isError: boolean }>
): Promise<McpSdkServerConfigWithInstance> {
  const { createSdkMcpServer, tool } = await loadClaudeAgentSdk()
  const tools = Object.entries(HOME_CHAT_TOOLS).map(([name, spec]) =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Object.entries loses the literal key type of HOME_CHAT_TOOLS.
    tool(name, spec.description, spec.shape as z.ZodRawShape, async (args) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: name is a key of HOME_CHAT_TOOLS.
      const result = await runTool(name as HomeChatToolName, args)
      return { content: [{ type: 'text', text: result.text }], isError: result.isError }
    })
  )
  return createSdkMcpServer({ name: SEAL_MCP_SERVER_NAME, version: '1.0.0', tools })
}

/** A headless Claude Code chat on the user's subscription, kept open between turns. */
export function createClaudeCodeSession(options: ClaudeCodeSessionOptions): HomeChatBackendSession {
  let connection: ClaudeStreamJsonConnection | null = null
  let sessionId = options.resumeSessionId
  let active: ActiveTurn | null = null

  const failActive = (error: Error): void => {
    const turn = active
    active = null
    connection = null
    turn?.translator.finish()
    turn?.done.reject(error)
  }

  const open = async (systemPrompt: string): Promise<ClaudeStreamJsonConnection> => {
    const sources = await resolveClaudeChildEnvSources({})
    const env = { ...claudeChildEnv(sources), MCP_TOOL_TIMEOUT: MCP_TOOL_TIMEOUT_MS }
    if (options.claudeConfigDir) {
      Object.assign(env, claudeConfigDirEnvPatch(options.claudeConfigDir, { env }))
    }
    const resume = sessionId
    sessionId ??= randomUUID()
    options.onSessionId(sessionId)
    const server = await buildSealMcpServer((tool, args) => {
      if (!active) {
        return Promise.resolve({ text: 'No turn is running.', isError: true })
      }
      return active.ctx.runTool(tool, args)
    })
    return openClaudeStreamJsonConnection(
      {
        pathToClaudeCodeExecutable: sources.command,
        prefixArgs: sources.prefixArgs,
        cwd: options.cwd,
        env,
        options: {
          includePartialMessages: true,
          systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt },
          // Isolate from the user's hooks and project settings, which target coding sessions.
          settingSources: [],
          supportedDialogKinds: [],
          mcpServers: { [SEAL_MCP_SERVER_NAME]: server },
          allowedTools: [`mcp__${SEAL_MCP_SERVER_NAME}`],
          disallowedTools: DISALLOWED_BUILTIN_TOOLS,
          ...(resume ? { resume } : { sessionId })
        }
      },
      {
        onMessage: (message) => {
          const turn = active
          if (!turn) {
            return
          }
          const signal = turn.translator.handle(message)
          if (signal.sessionId && signal.sessionId !== sessionId) {
            sessionId = signal.sessionId
            options.onSessionId(signal.sessionId)
          }
          if (signal.turnDone) {
            active = null
            if (signal.error && !turn.ctx.signal.aborted) {
              turn.done.reject(new Error(signal.error))
            } else {
              turn.done.resolve()
            }
          }
        },
        canUseTool: (toolName) =>
          Promise.resolve({
            behavior: 'deny',
            message: `${toolName} is not available here. Use Seal's tools (run_command, read_file, …) and name the machine.`
          }),
        onFault: failActive,
        onExit: failActive
      }
    )
  }

  return {
    runTurn: async (text, ctx) => {
      if (active) {
        throw new Error('A turn is already running in this chat')
      }
      connection ??= await open(ctx.systemPrompt)
      const turn: ActiveTurn = {
        ctx,
        translator: new ClaudeStreamTranslator(ctx.writer),
        done: Promise.withResolvers<void>()
      }
      // A fault can settle the turn while send() is still pending and nobody awaits it yet.
      turn.done.promise.catch(() => undefined)
      active = turn
      const onAbort = (): void => {
        void connection?.interrupt().catch(() => undefined)
      }
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      try {
        await connection.send({
          type: 'user',
          uuid: randomUUID(),
          message: { role: 'user', content: [{ type: 'text', text }] },
          parent_tool_use_id: null,
          session_id: sessionId
        })
        await turn.done.promise
      } finally {
        ctx.signal.removeEventListener('abort', onAbort)
        if (active === turn) {
          active = null
        }
        turn.translator.finish()
      }
    },
    close: async () => {
      const current = connection
      connection = null
      await current?.close()
    }
  }
}
