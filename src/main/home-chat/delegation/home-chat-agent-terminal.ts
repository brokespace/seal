import type { HomeChatToolContext } from '../tools/home-chat-tool-executor'
import { parseOrcaJson, terminalTail, waitSatisfied } from './home-chat-orca-json'

type RunOrcaCli = HomeChatToolContext['runOrcaCli']

const CLI_TIMEOUT_MS = 60_000

export async function sendToAgentTerminal(
  runOrcaCli: RunOrcaCli,
  terminal: string,
  input: { text: string } | { interrupt: true }
): Promise<void> {
  const args = 'text' in input ? ['--text', input.text, '--enter'] : ['--interrupt']
  const result = await runOrcaCli(['terminal', 'send', '--terminal', terminal, ...args, '--json'], {
    timeoutMs: CLI_TIMEOUT_MS
  })
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || 'terminal send failed')
  }
}

export async function readAgentTerminalTail(
  runOrcaCli: RunOrcaCli,
  terminal: string,
  lines: number
): Promise<string> {
  const result = await runOrcaCli(
    ['terminal', 'read', '--terminal', terminal, '--limit', String(lines), '--json'],
    { timeoutMs: CLI_TIMEOUT_MS }
  )
  return terminalTail(parseOrcaJson(result.stdout)) || (result.stderr || result.stdout).trim()
}

/** True once the agent's TUI is idle; false when the wait timed out. Throws when the CLI failed. */
export async function waitForAgentIdle(
  runOrcaCli: RunOrcaCli,
  terminal: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<boolean> {
  const result = await runOrcaCli(
    [
      'terminal',
      'wait',
      '--terminal',
      terminal,
      '--for',
      'tui-idle',
      '--timeout-ms',
      String(timeoutMs),
      '--json'
    ],
    { timeoutMs: timeoutMs + CLI_TIMEOUT_MS, signal }
  )
  if (waitSatisfied(parseOrcaJson(result.stdout))) {
    return true
  }
  if (result.exitCode !== 0 && !result.stdout.trim()) {
    throw new Error(result.stderr)
  }
  return false
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}
