// Sessions running in Seal's own terminal panes, as Orca's hook server reports them.
import type { PendingPrompt } from '../../../shared/agent-status/contracts/agent-pending-prompt'
import type {
  AgentSessionSurface,
  LiveSession,
  LiveSessionMachine,
  LiveSessionStatus
} from '../../../shared/live-sessions/live-session-types'
import { liveSessionId } from '../../../shared/live-sessions/live-session-id'
import { isWaitingOnBackgroundWork } from '../../../shared/live-sessions/live-session-status'
import {
  sealPaneFromRow,
  sealPaneProviderSession,
  sealPaneRecord,
  type SealPane,
  type SealPaneRow
} from '../../../shared/live-sessions/seal-pane-session'
import { liveSessionAdapter } from '../adapters/live-session-adapters'
import { sessionCapabilities } from '../adapters/session-capabilities'
import { LOCAL_HOST_ID } from '../hosts/live-session-hosts'

export {
  permissionFromPendingPrompt,
  type SealPane,
  type SealPaneRow
} from '../../../shared/live-sessions/seal-pane-session'

/** What a finished turn may still rest on, which a Stop hook does not say. */
const RESTS_ON: ReadonlySet<LiveSessionStatus> = new Set([
  'waiting-subagent',
  'waiting-input',
  'errored'
])

/** What a turn at work may be doing, which a tool hook does not say. */
const WORKS_ON: ReadonlySet<LiveSessionStatus> = new Set([
  'waiting-subagent',
  'waiting-task',
  'running-shell'
])

export function sealPanesFromRows(
  rows: SealPaneRow[],
  pendingPrompt: (paneKey: string, agent: LiveSession['provider']) => PendingPrompt | null,
  now: number
): SealPane[] {
  return rows.flatMap((row) => {
    const adapter = liveSessionAdapter(row.agentType)
    // A chat's row is its structured host's projection: the structured source lists it.
    if (!adapter || row.structuredHost !== undefined || row.providerSessionOnly) {
      return []
    }
    // Discovery lists an agent it can find until its hooks name the session.
    if (!sealPaneProviderSession(row, adapter)?.id && adapter.discovery) {
      return []
    }
    const prompt =
      row.state === 'blocked' || row.state === 'waiting'
        ? pendingPrompt(row.paneKey, adapter.agent)
        : null
    return [sealPaneFromRow(row, adapter, prompt, now)]
  })
}

export const REMOTE_SEAL_MACHINE: LiveSessionMachine = {
  hostId: 'seal-remote',
  label: 'Remote Seal host',
  kind: 'remote'
}

/**
 * A pane's hooks say when a turn starts, asks and stops. What it runs meanwhile and what it left
 * behind when it stopped come from the agent itself: its transcript, its processes, its own state.
 */
function discoveryKnowsMore(pane: SealPane, found: LiveSession): boolean {
  if (pane.silent) {
    return true
  }
  if (found.statusSource === 'screen') {
    return found.permission !== null
  }
  // A wait read with what the ended turn left running is that turn's; any other is a stale read.
  const endedOnWait =
    pane.status === 'your-turn' &&
    found.status === 'waiting-task' &&
    found.backgroundWait !== undefined
  if (endedOnWait) {
    return true
  }
  if (found.statusSource === 'classifier') {
    return false
  }
  if (endedWithoutHook(pane, found)) {
    return true
  }
  // Claude's own word on a prompt or a turn its hooks did not announce (a wake-up, a compaction).
  const agentSays =
    found.statusSource === 'agent-state' &&
    (found.status === 'working' ||
      found.status === 'needs-permission' ||
      found.status === 'waiting-input')
  if (pane.status === 'your-turn') {
    return RESTS_ON.has(found.status) || agentSays
  }
  if (pane.status === 'working') {
    return WORKS_ON.has(found.status) || (agentSays && found.status !== 'working')
  }
  // Which kind of work, and how much of it.
  return isWaitingOnBackgroundWork(pane.status) && isWaitingOnBackgroundWork(found.status)
}

/** How much later than a pane's last hook its transcript must record the end of the turn. */
const TURN_END_AFTER_HOOK_MS = 3_000

/**
 * A turn cut short fires no Stop hook (Esc, a crash): the pane's last hook still says a tool runs,
 * and the transcript, written after it, says the turn is over. Both clocks are this machine's.
 */
function endedWithoutHook(pane: SealPane, found: LiveSession): boolean {
  return (
    pane.status === 'working' &&
    pane.connectionId === null &&
    found.statusSource === 'transcript' &&
    (found.status === 'your-turn' || found.status === 'errored') &&
    found.lastActivityAt - pane.receivedAt > TURN_END_AFTER_HOOK_MS
  )
}

/** Seal's hooks know its own panes best; discovery adds what they don't say (machine, liveness, title). */
export function mergeSealPanes(
  discovered: LiveSession[],
  panes: SealPane[],
  localMachine: LiveSessionMachine,
  /** Told of each pane whose session discovery finds with no process running it. */
  onUnseenAgent?: (paneKey: string) => void
): LiveSession[] {
  const out = [...discovered]
  for (const pane of panes) {
    const sameHost = (s: LiveSession) =>
      s.provider === pane.provider &&
      (pane.connectionId === null) === (s.machine.hostId === LOCAL_HOST_ID)
    // The pane's own process, found before its first prompt or under another file name.
    const index = [
      (s: LiveSession) => s.providerSessionId === pane.providerSessionId,
      (s: LiveSession) => pane.transcriptPath !== null && s.transcriptPath === pane.transcriptPath,
      (s: LiveSession) =>
        s.providerSessionId.startsWith('pid-') && s.alive && s.cwd === pane.cwd && s.cwd !== null
    ]
      .map((matches) => out.findIndex((s) => sameHost(s) && matches(s)))
      .find((i) => i !== -1)
    const route = { kind: 'seal-pane' as const, paneKey: pane.paneKey }
    const surface: AgentSessionSurface = { kind: 'cli', paneKey: pane.paneKey }
    if (index !== undefined) {
      const found = out[index]
      const fromDiscovery = discoveryKnowsMore(pane, found)
      if (!found.alive) {
        onUnseenAgent?.(pane.paneKey)
      }
      const named = found.providerSessionId.startsWith('pid-')
        ? {
            id: liveSessionId(found.machine.hostId, pane.provider, pane.providerSessionId),
            providerSessionId: pane.providerSessionId,
            transcriptPath: found.transcriptPath ?? pane.transcriptPath
          }
        : {}
      const merged = {
        ...found,
        ...named,
        origin: 'seal' as const,
        surface,
        title: found.title ?? pane.prompt,
        status: fromDiscovery ? found.status : pane.status,
        statusSource: fromDiscovery ? found.statusSource : 'seal-hooks',
        statusDetail:
          fromDiscovery || (pane.statusDetail === null && found.status === pane.status)
            ? found.statusDetail
            : pane.statusDetail,
        lastActivityAt: Math.max(found.lastActivityAt, pane.receivedAt),
        alive: true,
        inputRoutes: [route, ...found.inputRoutes.filter((r) => r.kind !== 'resume')],
        permission: pane.permission ?? found.permission,
        lastMessage: fromDiscovery
          ? (found.lastMessage ?? pane.lastMessage)
          : (pane.lastMessage ?? found.lastMessage ?? null)
      }
      out[index] = { ...merged, capabilities: sessionCapabilities(merged) }
      continue
    }
    const added = sealPaneRecord(
      pane,
      pane.connectionId === null ? localMachine : REMOTE_SEAL_MACHINE
    )
    out.push({ ...added, capabilities: sessionCapabilities(added) })
  }
  return out
}
