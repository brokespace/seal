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

/**
 * When each command under an agent started (epoch ms, host clock); null when the host listed no
 * processes, so a caller cannot tell a prompt from a running command.
 */
export type ToolProcessStarts = (pid: number, provider: LiveSessionProvider) => number[] | null

export function toolProcessStarts(
  output: Pick<DiscoveryOutput, 'processes'> & Partial<Pick<DiscoveryOutput, 'children'>>,
  nowMs: number
): ToolProcessStarts {
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
      .map((child) => nowMs - child.elapsedMs)
}
