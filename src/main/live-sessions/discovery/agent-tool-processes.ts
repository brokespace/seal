// The commands an agent's tools are running right now, read from the processes under it.
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import type { DiscoveredChild, DiscoveryOutput } from './discovery-output'

const COMMAND_KINDS: ReadonlySet<DiscoveredChild['kind']> = new Set([
  'snapshot',
  'sandbox',
  'shell'
])

/** Codex runs commands from its app-server, which outlives the terminal that started it and serves every Codex session on the host. */
const CODEX_APP_SERVER = /(^|\/)codex(\.js)? app-server( |$)/

export type ToolProcess = {
  /** When it started (epoch ms, host clock). */
  startedAt: number
  /** Claude Code's own Bash tool started it: the one child that is surely a command of the agent's. */
  claudeBash: boolean
  /** The programs running under it right now, by name: `sleep` for a loop between two checks. */
  runs: string[]
}

/**
 * The commands running under an agent; null when the host listed no processes, so a caller
 * cannot tell a prompt from a running command.
 */
export type ToolProcesses = (pid: number, provider: LiveSessionProvider) => ToolProcess[] | null

export function toolProcesses(
  output: Pick<DiscoveryOutput, 'processes'> & Partial<Pick<DiscoveryOutput, 'children'>>,
  nowMs: number
): ToolProcesses {
  const children = output.children ?? null
  if (children === null) {
    return () => null
  }
  const byParent = new Map<number, DiscoveredChild[]>()
  for (const child of children) {
    byParent.set(child.ppid, [...(byParent.get(child.ppid) ?? []), child])
  }
  const under = (roots: number[]): DiscoveredChild[] => {
    const found = new Map<number, DiscoveredChild>()
    const queue = [...roots]
    while (queue.length > 0) {
      for (const child of byParent.get(queue.pop()!) ?? []) {
        if (!found.has(child.pid)) {
          found.set(child.pid, child)
          queue.push(child.pid)
        }
      }
    }
    return [...found.values()]
  }
  const appServers = output.processes.filter((p) => CODEX_APP_SERVER.test(p.args)).map((p) => p.pid)
  return (pid, provider) =>
    under(provider === 'codex' ? [pid, ...appServers] : [pid])
      .filter((child) => COMMAND_KINDS.has(child.kind))
      .map((child) => ({
        startedAt: nowMs - child.elapsedMs,
        claudeBash: child.kind === 'snapshot',
        runs: [
          ...new Set(
            under([child.pid])
              .filter((below) => below.kind === 'other')
              .map((below) => below.command)
          )
        ].sort()
      }))
}
