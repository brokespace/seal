// A Claude CLI session in a Seal terminal pane, as its hook script reports it to the agent hook server.
// Modelled on host-terminal-agent-phone-push.spec.ts ("a desktop with a window pushes its phone once").
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { postClaudeHook, readHookEndpoint } from './agent-hook-endpoint'
import { quotePosixShell } from '../../../src/shared/shell/launch/shell-argument-quoting'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './store'
import {
  execInTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput,
  type ActivePaneHookDescriptor
} from './terminal'

export type TerminalPaneClaudeSession = {
  /** The id rows and the registry use: `local:claude:<providerSessionId>`. */
  sessionId: string
  providerSessionId: string
  pane: ActivePaneHookDescriptor
  /** `UserPromptSubmit`: the pane reads as `working`. */
  submitPrompt: (prompt: string) => Promise<void>
  /** `Stop` with the turn's last message: `your-turn` (the hook state `done`). */
  finishTurn: (lastAssistantMessage: string) => Promise<void>
  /** `PermissionRequest` for the question tool: `waiting-input`. */
  askQuestion: (question: string) => Promise<void>
  /** `PermissionRequest` for any other tool: `needs-permission`. */
  requestPermission: (toolName: string, toolInput: Record<string, unknown>) => Promise<void>
  /** Any other hook event, with this session's id filled in. */
  post: (payload: Record<string, unknown>) => Promise<void>
}

const CLAUDE_PROCESS = path.join(
  process.cwd(),
  'tests/e2e/fixtures/terminal-pane-claude-process.cjs'
)

/**
 * Binds the active terminal pane to a Claude session id. A process titled `claude` holds the
 * pane (POSIX shells only) and each call posts the hook event a real `claude` would. The registry
 * lists the pane from its first event on, and lists the holding process as an idle external
 * session `local:claude:pid-<pid>` of its own.
 */
export async function startTerminalPaneClaudeSession(
  app: ElectronApplication,
  page: Page,
  options: { providerSessionId?: string; cwd?: string } = {}
): Promise<TerminalPaneClaudeSession> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  const endpoint = await readHookEndpoint(app)
  const pane = await waitForActivePaneHookDescriptor(page)
  // A pane whose foreground is the shell reads as an exited agent and loses its row.
  await execInTerminal(
    page,
    await waitForActivePanePtyId(page),
    [process.execPath, CLAUDE_PROCESS].map(quotePosixShell).join(' ')
  )
  await waitForTerminalOutput(page, 'SEAL_E2E_CLAUDE_PROCESS_READY', 20_000)
  // The registry only lists a pane whose hooks name a provider session.
  const providerSessionId = options.providerSessionId ?? randomUUID()
  const post = (payload: Record<string, unknown>): Promise<void> =>
    postClaudeHook(endpoint, pane, {
      session_id: providerSessionId,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...payload
    })
  const requestPermission = (toolName: string, toolInput: Record<string, unknown>): Promise<void> =>
    post({ hook_event_name: 'PermissionRequest', tool_name: toolName, tool_input: toolInput })

  return {
    sessionId: `local:claude:${providerSessionId}`,
    providerSessionId,
    pane,
    submitPrompt: (prompt) => post({ hook_event_name: 'UserPromptSubmit', prompt }),
    finishTurn: (lastAssistantMessage) =>
      post({ hook_event_name: 'Stop', last_assistant_message: lastAssistantMessage }),
    askQuestion: (question) =>
      requestPermission('AskUserQuestion', {
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
    requestPermission,
    post
  }
}
