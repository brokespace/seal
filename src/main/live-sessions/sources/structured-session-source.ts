import type { AgentSessionStatusEvent } from '../../../shared/agent-session/agent-session-wire'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import type {
  LiveSession,
  LiveSessionMachine
} from '../../../shared/live-sessions/live-session-types'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import {
  getStructuredAgentSessionHost,
  onStructuredAgentSessionsHeldChanged
} from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { StructuredSessionInput } from '../delivery/session-input-routes'
import type { UserText } from '../delivery/transcript-user-texts'
import type { LiveSessionSource } from './live-session-source'
import { createStructuredSessionDirectories } from './structured-session-directories'
import {
  hostOwnsStructuredSession,
  structuredSessionHostFacts
} from './structured-session-host-facts'
import { createStructuredSessionInput } from './structured-session-input'
import { createStructuredSessionJournalDetails } from './structured-session-journal-detail'
import { createStructuredJournalTexts } from './structured-session-journal-texts'
import { structuredLiveSession } from './structured-session-record'
import { deleteChatTranscripts } from './structured-session-transcript-deletion'

export type StructuredSessionAccess = {
  /** One record per chat this process's host owns. `sessions()` is synchronous: serve it from a cache. */
  source: LiveSessionSource
  /** The `structured` input route and the chat answer path. */
  input: StructuredSessionInput
  /** How far the chat's journal goes now: the offset the outbox stores before it sends. */
  journalSize(sessionId: string): Promise<number>
  /** What the journal records the user saying at or after offset `from`. */
  userTexts(sessionId: string, from: number): Promise<UserText[]>
  /** Ends the chat's agent (Remove with stop). True when it is stopped or was not running. */
  stop(sessionId: string): Promise<boolean>
  /** Deletes the provider's transcript of the chat, found by its session id when the record names no file. */
  deleteTranscripts(session: LiveSession): Promise<void>
  dispose(): void
}

/** Catches what no event tells: a chat ageing out, a record removed, a host installed late. */
const SAFETY_REFRESH_MS = 15_000

export function createStructuredSessionAccess(
  runtime: OrcaRuntimeService,
  deps: {
    /** The machine record for a chat's `record.location.executionHostId`; null when unknown (skip the chat). */
    machineOf(executionHostId: string): LiveSessionMachine | null
    now?: () => number
    log?: (message: string, error?: unknown) => void
  }
): StructuredSessionAccess {
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const listeners = new Set<() => void>()
  const cached = new Map<string, { session: LiveSession; json: string }>()
  let published: LiveSession[] = []
  let host: StructuredAgentSessionHost | null = null
  /** The status subscription in force; an older one's events are dropped. */
  let subscription: { end(): void } | null = null
  let askedForHost = false
  let disposed = false

  const details = createStructuredSessionJournalDetails({
    read: (sessionId) =>
      host?.hasSession(sessionId)
        ? host.journalCurrentRead(sessionId).then((read) => read.items)
        : null,
    onChange: (sessionId) => refreshOne(sessionId),
    log
  })
  const directories = createStructuredSessionDirectories({
    resolve: (workspaceId) => host?.deps.resolveWorkspacePath?.(workspaceId) ?? null,
    onResolved: () => refreshAll(),
    now
  })

  const build = (record: AgentSessionRecord): LiveSession | null => {
    if (!host || !hostOwnsStructuredSession(host, record)) {
      return null
    }
    const machine = deps.machineOf(record.location.executionHostId)
    if (!machine) {
      return null
    }
    try {
      const facts = structuredSessionHostFacts(host, record, {
        machine,
        detail: details.get(record.sessionId),
        cwd: directories.of(record),
        now: now()
      })
      return facts ? structuredLiveSession(facts) : null
    } catch (error) {
      log(`Could not list chat ${record.sessionId}.`, error)
      return null
    }
  }

  /** True when the chat's cached record changed. */
  const put = (sessionId: string, session: LiveSession | null): boolean => {
    if (!session) {
      details.forget(sessionId)
      return cached.delete(sessionId)
    }
    const json = JSON.stringify(session)
    if (cached.get(sessionId)?.json === json) {
      return false
    }
    cached.set(sessionId, { session, json })
    return true
  }

  const publish = (): void => {
    published = [...cached.values()].map((entry) => entry.session)
    for (const listener of listeners) {
      listener()
    }
  }

  function refreshOne(sessionId: string): void {
    if (disposed) {
      return
    }
    const record = host?.deps.store.getRecord(sessionId) ?? null
    if (put(sessionId, record ? build(record) : null)) {
      publish()
    }
  }

  function refreshAll(): void {
    if (disposed) {
      return
    }
    const records = host?.deps.store.listRecords() ?? []
    const held = new Set(records.map((record) => record.sessionId))
    let changed = false
    for (const record of records) {
      changed = put(record.sessionId, build(record)) || changed
    }
    for (const sessionId of cached.keys()) {
      changed = (!held.has(sessionId) && put(sessionId, null)) || changed
    }
    if (changed) {
      publish()
    }
  }

  const onStatus = (event: AgentSessionStatusEvent): void => {
    if (event.type === 'status') {
      details.refresh(event.session.sessionId)
      refreshOne(event.session.sessionId)
    } else if (event.type === 'snapshot') {
      refreshAll()
    }
  }

  /** Follows the host the process has now: installed after startup, or replaced. */
  const attach = (): void => {
    const next = disposed ? null : getStructuredAgentSessionHost()
    if (next === host && (subscription || !next)) {
      return
    }
    const ending = subscription
    subscription = null
    ending?.end()
    host = next
    if (!next) {
      return
    }
    const current = { end: (): void => {} }
    subscription = current
    try {
      current.end = next.subscribeStatus({
        id: 'live-sessions',
        emit: (event) => {
          if (subscription !== current) {
            return
          }
          if (event.type === 'end') {
            subscription = null
          } else {
            onStatus(event)
          }
        }
      })
    } catch (error) {
      subscription = null
      log('Could not follow the status of chats.', error)
    }
  }

  const refreshFromHost = (): void => {
    attach()
    refreshAll()
    for (const sessionId of host?.loadedSessionIds() ?? []) {
      details.refresh(sessionId)
    }
  }

  const tick = (): void => {
    refreshFromHost()
    // Saved chats need their host before anything asks for it: a server with no client open.
    if (!host && !askedForHost) {
      askedForHost = true
      void runtime
        .prepareStructuredAgentSessionStartupRestoration()
        .then(refreshFromHost)
        .catch((error: unknown) => log('Could not start the host of saved chats.', error))
    }
  }

  const stopWatchingHeld = onStructuredAgentSessionsHeldChanged(refreshFromHost)
  let checkedAt = now()
  refreshFromHost()

  const texts = createStructuredJournalTexts(() => host, now)

  return {
    source: {
      // The store tells of no removed record and no chat grows old on its own: the registry's
      // scans, which read this, set the pace of looking again.
      sessions: () => {
        if (!disposed && now() - checkedAt >= SAFETY_REFRESH_MS) {
          checkedAt = now()
          queueMicrotask(tick)
        }
        return published
      },
      subscribe: (onChange) => {
        listeners.add(onChange)
        return () => listeners.delete(onChange)
      }
    },
    input: createStructuredSessionInput({ host: () => host, onQueued: texts.noteQueued, now }),
    journalSize: texts.journalSize,
    userTexts: texts.userTexts,
    stop: async (sessionId) => {
      const current = host
      if (!current) {
        return true
      }
      try {
        // The close a chat's tab makes: the agent stops, the chat and its history stay.
        await current.close(sessionId, 'user-close')
      } catch (error) {
        log(`Could not stop chat ${sessionId}.`, error)
      }
      return !current.loadedSessionIds().includes(sessionId)
    },
    deleteTranscripts: deleteChatTranscripts,
    dispose: () => {
      disposed = true
      stopWatchingHeld()
      listeners.clear()
      attach()
    }
  }
}
