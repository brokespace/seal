import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import { CLAUDE_PROFILE_POINTER_ENV } from '../../shared/claude-profile-routing'

export type SealTerminalAction = { text?: string; enter?: boolean; interrupt?: boolean }

/** The slice of an agent status-hook row Seal reads: which conversation a pane runs, and how it stopped. */
export type SealAgentStatusRow = {
  paneKey: string
  state: string
  lastAssistantMessage?: string
  receivedAt: number
  providerSession?: { id: string }
}

/** What Seal needs from the runtime that owns this host's panes; set where the runtime is built. */
export type SealSessionTerminal = {
  statusRows(): readonly SealAgentStatusRow[]
  handleForPane(paneKey: string): string | null
  send(handle: string, action: SealTerminalAction): Promise<unknown>
  isAgentRunning(handle: string): Promise<boolean>
}

let terminal: SealSessionTerminal | null = null

export function setSealSessionTerminal(next: SealSessionTerminal | null): void {
  terminal = next
}

export function sealSessionTerminal(): SealSessionTerminal | null {
  return terminal
}

const STOP_ATTEMPTS = 4
const STOP_SETTLE_MS = 700
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.())
}

/** Interrupts until the agent leaves the pane (Claude and Codex both exit on a repeated Ctrl-C). */
export async function stopAgentInPane(
  pane: Pick<SealSessionTerminal, 'send' | 'isAgentRunning'>,
  handle: string,
  settleMs = STOP_SETTLE_MS
): Promise<boolean> {
  for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt += 1) {
    if (!(await pane.isAgentRunning(handle))) {
      return true
    }
    await pane.send(handle, { interrupt: true })
    await delay(settleMs)
  }
  return !(await pane.isAgentRunning(handle))
}

function quote(value: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * The shell line that resumes one conversation in the same pane. A Claude pane that had no
 * session home gets one through its pointer, which Orca's `claude` shell function reads.
 */
export function resumeCommandLine(args: {
  provider: SealProvider
  providerSessionId: string
  platform: NodeJS.Platform
  claudePointer?: string
  codexHome?: string
}): string {
  if (!SAFE_SESSION_ID.test(args.providerSessionId)) {
    throw new Error('This session has an id Seal cannot resume safely.')
  }
  const env: [string, string][] = []
  if (args.provider === 'claude' && args.claudePointer) {
    env.push([CLAUDE_PROFILE_POINTER_ENV, args.claudePointer])
  }
  if (args.provider === 'codex' && args.codexHome) {
    env.push(['CODEX_HOME', args.codexHome])
  }
  const command =
    args.provider === 'claude'
      ? `claude --resume ${args.providerSessionId}`
      : `codex resume ${args.providerSessionId}`
  if (args.platform === 'win32') {
    const assignments = env.map(([name, value]) => `$env:${name}=${quote(value, 'win32')}; `)
    return `${assignments.join('')}${command}`
  }
  const prefix = env.map(([name, value]) => `${name}=${quote(value, args.platform)} `)
  return `${prefix.join('')}${command}`
}
