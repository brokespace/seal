import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { LiveSessionsView } from '../LiveSessionsPage'
import { RemoveLiveSessionsDialog } from './RemoveLiveSessionsDialog'

const NOW = 1_800_000_000_000
const local = { hostId: 'local', label: 'brian-mbp', kind: 'local' } as const

function session(overrides: Partial<LiveSession> & Pick<LiveSession, 'id'>): LiveSession {
  return {
    provider: 'claude',
    providerSessionId: overrides.id,
    machine: local,
    origin: 'external',
    cwd: '/Users/brian/code/seal',
    project: 'seal',
    title: null,
    status: 'waiting-input',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: NOW - 60_000,
    startedAt: NOW - 3_600_000,
    alive: true,
    pid: 4242,
    transcriptPath: `/Users/brian/.claude/projects/-Users-brian-code-seal/${overrides.id}.jsonl`,
    inputRoutes: [{ kind: 'tmux', target: '%3', socket: '/private/tmp/tmux-501/seal' }],
    permission: null,
    ...overrides
  }
}

const sessions: LiveSession[] = [
  session({
    id: '6a278a68-fb5f-4a43-8007-6af95f274293',
    title: 'Fix the flaky sidebar test',
    status: 'working'
  }),
  session({
    id: '41532093-df01-43f6-9790-bab8fff5a196',
    title: 'Release notes draft',
    status: 'done',
    alive: false,
    pid: null,
    lastActivityAt: NOW - 7_200_000,
    inputRoutes: [{ kind: 'resume' }]
  }),
  session({
    id: 'codex-1',
    provider: 'codex',
    providerSessionId: '019a1d6b-7195-7f30-a99f-7701358a1986',
    title: 'Queue retries',
    status: 'errored',
    alive: false,
    pid: null,
    lastActivityAt: NOW - 3_000_000,
    transcriptPath:
      '/Users/brian/.codex/sessions/2026/11/13/rollout-2026-11-13T20-54-10-019a1d6b-7195-7f30-a99f-7701358a1986.jsonl',
    inputRoutes: [{ kind: 'resume' }]
  })
]

const remove = async () => ({ removed: [], failed: [] })
const noop = () => {}

export const bulkStopAndRemove = defineFixture({
  width: 1100,
  render: () => (
    <div className="flex h-[640px]">
      <LiveSessionsView
        loaded
        sessions={sessions}
        hostErrors={{}}
        selectedId={null}
        onSelect={noop}
        onRefresh={noop}
        now={NOW}
        chat={null}
        initialChecked={[sessions[0].id, sessions[2].id]}
        removeSessions={remove}
      />
    </div>
  )
})

export const deleteTranscriptFiles = defineFixture({
  width: 700,
  render: () => (
    <div className="h-[560px]">
      <RemoveLiveSessionsDialog
        sessions={[sessions[0], sessions[2]]}
        open
        onOpenChange={noop}
        remove={remove}
        defaultDeleteFiles
      />
    </div>
  )
})
