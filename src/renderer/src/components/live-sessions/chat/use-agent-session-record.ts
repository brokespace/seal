import { useSyncExternalStore } from 'react'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionRegistryStore } from '../live-session-registry-store'

/** How a chat view names its session: by registry record, by structured chat, or by terminal pane. */
export type AgentSessionFrameLookup =
  | { kind: 'record'; sessionId: string }
  | { kind: 'chat'; sessionId: string }
  | { kind: 'pane'; paneKey: string }

type RecordIndex = {
  byId: Map<string, LiveSession>
  byChat: Map<string, LiveSession>
  byPane: Map<string, LiveSession>
}

// Every mounted chat asks on each registry change; the array is new whenever a record changes.
const indexes = new WeakMap<readonly LiveSession[], RecordIndex>()

/** A pane or chat that ran several sessions shows the running one, else the one last active. */
function hold(records: Map<string, LiveSession>, key: string, session: LiveSession): void {
  const held = records.get(key)
  if (
    !held ||
    (session.alive !== held.alive ? session.alive : session.lastActivityAt > held.lastActivityAt)
  ) {
    records.set(key, session)
  }
}

function recordIndex(sessions: readonly LiveSession[]): RecordIndex {
  const known = indexes.get(sessions)
  if (known) {
    return known
  }
  const index: RecordIndex = { byId: new Map(), byChat: new Map(), byPane: new Map() }
  for (const session of sessions) {
    index.byId.set(session.id, session)
    if (session.surface.kind === 'chat') {
      hold(index.byChat, session.surface.sessionId, session)
    } else if (session.surface.kind === 'cli') {
      hold(index.byPane, session.surface.paneKey, session)
    }
  }
  indexes.set(sessions, index)
  return index
}

/** The record a chat view shows, or null. `currentId` follows a record id to the id it goes by now. */
export function findAgentSessionRecord(
  sessions: readonly LiveSession[],
  lookup: AgentSessionFrameLookup,
  currentId: (sessionId: string) => string
): LiveSession | null {
  const index = recordIndex(sessions)
  switch (lookup.kind) {
    case 'record':
      return index.byId.get(currentId(lookup.sessionId)) ?? null
    case 'chat':
      return index.byChat.get(lookup.sessionId) ?? null
    case 'pane':
      return index.byPane.get(lookup.paneKey) ?? null
  }
}

/** The registry record behind a chat view; it renders again only when that record changes. */
export function useAgentSessionRecord(lookup: AgentSessionFrameLookup): LiveSession | null {
  const read = (): LiveSession | null =>
    findAgentSessionRecord(liveSessionRegistryStore.getState().sessions, lookup, (sessionId) =>
      liveSessionRegistryStore.currentId(sessionId)
    )
  return useSyncExternalStore(liveSessionRegistryStore.subscribe, read)
}
