// Readers for `orca ... --json` output; fields follow the CLI's documented result shapes.
import { isRecord } from '../home-chat-record-guard'

function field(value: unknown, ...path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined
    }
    current = current[key]
  }
  return current
}

export function parseOrcaJson(stdout: string): unknown {
  const start = stdout.indexOf('{')
  if (start === -1) {
    return null
  }
  try {
    return JSON.parse(stdout.slice(start))
  } catch {
    return null
  }
}

function result(json: unknown): unknown {
  return field(json, 'result') ?? json
}

/** `worktree create --agent --json`: launch.outcome.handle, or agentTerminalHandle on older hosts. */
export function agentTerminalHandle(json: unknown): string | null {
  const handle =
    field(result(json), 'launch', 'outcome', 'handle') ?? field(result(json), 'agentTerminalHandle')
  return typeof handle === 'string' && handle ? handle : null
}

export function worktreeSelector(json: unknown): string | null {
  const worktree = field(result(json), 'worktree')
  const id = field(worktree, 'id')
  if (typeof id === 'string' && id) {
    return `worktree:${id}`
  }
  const path = field(worktree, 'path')
  return typeof path === 'string' && path ? `path:${path}` : null
}

export function waitSatisfied(json: unknown): boolean {
  return field(result(json), 'wait', 'satisfied') === true
}

export function terminalTail(json: unknown): string {
  const tail = field(result(json), 'terminal', 'tail')
  return Array.isArray(tail) ? tail.map(String).join('\n').trim() : ''
}
