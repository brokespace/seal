import { defineFixture } from '../../../component-fixtures/component-fixture'
import type {
  LiveSession,
  LiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-types'
import { SAMPLE_NOW, sampleLiveSession } from '../live-session.test-fixture'
import { WorkspaceSessionRowList, type WorkspaceSessionRowState } from './WorkspaceSessionRows'
import type { SidebarSessionFilters } from './sidebar-session-filter-store'
import { buildWorkspaceSessionRows } from './workspace-session-rows-model'

const MIN = 60_000
const NO_FILTERS: SidebarSessionFilters = { machine: null, status: null }
const SERVER = { hostId: 'gpu-box', label: 'gpu-box', kind: 'remote' as const }

const RUNNING_STATUSES: readonly { status: LiveSessionStatus; title: string; summary: string }[] = [
  {
    status: 'needs-permission',
    title: 'Rotate the deploy keys',
    summary: 'Wants to run the key rotation script against production.'
  },
  {
    status: 'waiting-input',
    title: 'Migrate settings storage',
    summary: 'Needs to know whether to migrate old profiles in place.'
  },
  {
    status: 'errored',
    title: 'Bump the lockfile',
    summary: 'The registry rejected the token; nothing was changed.'
  },
  {
    status: 'working',
    title: 'Rebrand app icons',
    summary: 'Exporting the new icon set at every size.'
  },
  {
    status: 'running-shell',
    title: 'Fix flaky sidebar test',
    summary: 'Running the sidebar suite for the third time.'
  },
  {
    status: 'waiting-subagent',
    title: 'Refactor upload pipeline',
    summary: 'Split the pipeline in three; two subagents are porting the callers.'
  },
  {
    status: 'waiting-task',
    title: 'Train tokenizer',
    summary: 'Waiting for the background training run to finish.'
  },
  {
    status: 'your-turn',
    title: 'Add rate limiting to uploads',
    summary: 'Added per-user upload rate limiting with tests.'
  },
  { status: 'idle', title: 'Explore the billing module', summary: 'Read the module; no changes.' }
]

function statusSessions(withSummary: boolean): LiveSession[] {
  return RUNNING_STATUSES.map(({ status, title, summary }, index) =>
    sampleLiveSession(status, {
      title,
      status,
      provider: index % 2 === 0 ? 'claude' : 'codex',
      lastActivityAt: SAMPLE_NOW - (index + 1) * MIN,
      startedAt: SAMPLE_NOW - (index + 4) * MIN,
      summary: withSummary ? summary : undefined
    })
  )
}

const MARKED: LiveSession[] = [
  sampleLiveSession('pinned', {
    title: 'Keep an eye on the release branch',
    pinned: true,
    lastActivityAt: SAMPLE_NOW - 50 * MIN,
    summary: 'Watching CI on the release branch.'
  }),
  sampleLiveSession('unread', {
    title: 'Write the migration guide',
    status: 'your-turn',
    lastActivityAt: SAMPLE_NOW - 2 * MIN,
    summary: 'Drafted the guide; three open questions at the end.'
  }),
  sampleLiveSession('remote', {
    machine: SERVER,
    provider: 'codex',
    title: 'Profile the data loader',
    status: 'working',
    startedAt: SAMPLE_NOW - 9 * MIN
  }),
  sampleLiveSession('ended', {
    title: 'Tidy the changelog',
    status: 'done',
    alive: false,
    lastActivityAt: SAMPLE_NOW - 3 * 60 * MIN,
    summary: 'Grouped the changelog by area.'
  }),
  sampleLiveSession('ended-earlier', {
    provider: 'codex',
    title: 'Remove the old feature flag',
    status: 'done',
    alive: false,
    lastActivityAt: SAMPLE_NOW - 7 * 60 * MIN
  })
]

function rowState(
  session: LiveSession,
  picked: ReadonlySet<string> | null
): WorkspaceSessionRowState {
  return {
    workspaceName: 'shop / checkout-flow',
    account: session.id === 'pinned' ? 'work' : null,
    unread: session.id === 'unread',
    current: session.id === 'waiting-input',
    highlighted: false,
    picked: picked ? picked.has(session.id) : null,
    machine: session.machine.kind === 'local' ? null : session.machine.label
  }
}

function CardRows({
  sessions,
  filters = NO_FILTERS,
  finishedOpen = false,
  picked = null
}: {
  sessions: readonly LiveSession[]
  filters?: SidebarSessionFilters
  finishedOpen?: boolean
  picked?: ReadonlySet<string> | null
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 bg-worktree-sidebar p-2 text-worktree-sidebar-foreground">
      <span className="text-[13px] leading-5 font-medium">checkout-flow</span>
      <WorkspaceSessionRowList
        worktreeId="workspace-1"
        view={buildWorkspaceSessionRows(sessions, filters, SAMPLE_NOW)}
        finishedOpen={finishedOpen}
        rowState={(session) => rowState(session, picked)}
        now={SAMPLE_NOW}
        onToggleFinished={() => {}}
        onOpen={() => {}}
        onPick={() => {}}
        menu={() => null}
      />
    </div>
  )
}

export const statuses = defineFixture({
  width: 300,
  render: () => <CardRows sessions={statusSessions(true)} />
})

export const statusesWithoutSummary = defineFixture({
  width: 300,
  render: () => <CardRows sessions={statusSessions(false)} />
})

export const narrow = defineFixture({
  width: 200,
  render: () => <CardRows sessions={statusSessions(true)} />
})

export const pinnedUnreadFinished = defineFixture({
  width: 300,
  render: () => <CardRows sessions={MARKED} />
})

export const finishedOpen = defineFixture({
  width: 300,
  render: () => <CardRows sessions={MARKED} finishedOpen />
})

export const selecting = defineFixture({
  width: 300,
  render: () => <CardRows sessions={MARKED} picked={new Set(['unread', 'remote'])} />
})

export const hiddenByFilters = defineFixture({
  width: 300,
  render: () => (
    <CardRows sessions={statusSessions(true)} filters={{ machine: null, status: 'attention' }} />
  )
})
