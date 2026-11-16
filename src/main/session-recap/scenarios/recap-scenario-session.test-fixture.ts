// A scenario's session on one surface: the row the registry would hold, the conversation's own
// file or journal, and the app's transcript readers over it.
import { join } from 'node:path'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { runLocalScript } from '../../live-sessions/hosts/local-shell-script'
import { journalSessionTranscript } from '../../live-sessions/transcripts/journal-session-transcript'
import { LiveTranscriptStreams } from '../../live-sessions/transcripts/live-transcript-streams'
import {
  sessionTranscripts,
  type SessionTranscripts
} from '../../live-sessions/transcripts/session-transcript'
import {
  chatJournalScenario,
  type ChatJournalScenario
} from './recap-scenario-chat-journal.test-fixture'
import {
  claudeScenarioTranscript,
  type RecapScenarioConversation
} from './recap-scenario-claude-transcript.test-fixture'
import { codexScenarioTranscript } from './recap-scenario-codex-transcript.test-fixture'
import type { RecapScenarioSurface } from './recap-scenario-schema.test-fixture'

export const RECAP_SCENARIO_START = Date.UTC(2026, 10, 13, 10, 0, 0)
export const RECAP_SCENARIO_STEP_MS = 2_000
/** The session's id, and the one it takes when a scenario has it start over. */
export const RECAP_SCENARIO_SESSION_IDS = [
  '7d0c1c0e-5a51-4f0a-9d0b-2a6f3c1e8b01',
  '7d0c1c0e-5a51-4f0a-9d0b-2a6f3c1e8b02'
]

/** A scenario's session as the registry would hold it on one surface, and where its conversation is written. */
export function recapScenarioSession(
  surface: RecapScenarioSurface,
  folder: string
): {
  session: LiveSession
  journal: ChatJournalScenario | null
  provider: 'claude' | 'codex'
  transcriptPath: string
  fileConversation: (path: string, id: string) => RecapScenarioConversation
} {
  const provider = surface === 'codex-cli' ? 'codex' : 'claude'
  const remote = surface === 'claude-ssh'
  const hostId = remote ? 'ssh-build-box' : 'local'
  const journal = surface === 'chat-journal' ? chatJournalScenario() : null
  const transcriptPath = join(folder, 'session-1.jsonl')
  return {
    provider,
    journal,
    transcriptPath,
    fileConversation: (path, id) =>
      provider === 'codex' ? codexScenarioTranscript(path, id) : claudeScenarioTranscript(path, id),
    session: {
      id: `${hostId}:${provider}:${RECAP_SCENARIO_SESSION_IDS[0]}`,
      provider,
      providerSessionId: RECAP_SCENARIO_SESSION_IDS[0],
      machine: {
        hostId,
        label: hostId,
        kind: remote ? 'remote' : 'local',
        connection: remote ? 'ssh' : 'local'
      },
      origin: journal ? 'seal' : 'external',
      cwd: '/srv/shop',
      project: 'shop',
      title: null,
      status: 'idle',
      statusSource: 'transcript',
      statusDetail: null,
      lastActivityAt: RECAP_SCENARIO_START,
      startedAt: RECAP_SCENARIO_START,
      alive: true,
      pid: 4242,
      transcriptPath: journal ? null : transcriptPath,
      inputRoutes: [],
      permission: null,
      ...(journal ? { surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' } } : {})
    }
  }
}

/** The app's own transcript readers over a scenario's session, whatever id it goes by now. */
export function recapScenarioTranscripts(
  current: () => LiveSession,
  journal: ChatJournalScenario | null
): SessionTranscripts {
  const sessionOf = (id: string): LiveSession | null => (id === current().id ? current() : null)
  // The SSH reader's own script, run in a local shell: the bounded base64 reads are the same.
  const streams = new LiveTranscriptStreams({
    get: sessionOf,
    host: () => ({ machine: current().machine, run: runLocalScript })
  })
  return sessionTranscripts(sessionOf, {
    files: {
      page: (id, before, limit) => streams.page(id, before, limit),
      since: (id, cursor) => streams.since(id, cursor)
    },
    journal: (_chat, recordId) =>
      journal ? journalSessionTranscript(recordId, journal.read) : null
  })
}
