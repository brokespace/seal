import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionPinnedLaunchDirectory } from '../../runtime/agent-session/records/agent-session-record-launch-directory'

type Located = Pick<AgentSessionRecord, 'launchDirectory' | 'location'>

/** A workspace that did not resolve is asked again after this: its repo may load later. */
const RETRY_UNRESOLVED_MS = 60_000

export type StructuredSessionDirectories = {
  /** The folder the chat's agent runs in, when known now; resolving goes on behind. */
  of(record: Located): string | null
}

export function createStructuredSessionDirectories(deps: {
  /** Null when the host cannot resolve workspaces. */
  resolve(workspaceId: string): Promise<string> | null
  onResolved(): void
  now(): number
}): StructuredSessionDirectories {
  const resolved = new Map<string, { path: string | null; at: number }>()
  const resolving = new Set<string>()

  const resolve = (workspaceId: string): void => {
    if (resolving.has(workspaceId)) {
      return
    }
    const path = deps.resolve(workspaceId)
    if (!path) {
      return
    }
    resolving.add(workspaceId)
    void path
      .then((found) => found || null)
      .catch(() => null)
      .then((found) => {
        resolving.delete(workspaceId)
        const before = resolved.get(workspaceId)?.path ?? null
        resolved.set(workspaceId, { path: found, at: deps.now() })
        if (found !== before) {
          deps.onResolved()
        }
      })
  }

  return {
    of: (record) => {
      const pinned = agentSessionPinnedLaunchDirectory(record)
      if (pinned) {
        return pinned
      }
      const { workspaceId } = record.location
      const known = resolved.get(workspaceId)
      if (!known || (known.path === null && deps.now() - known.at > RETRY_UNRESOLVED_MS)) {
        resolve(workspaceId)
      }
      return known?.path ?? record.launchDirectory ?? null
    }
  }
}
