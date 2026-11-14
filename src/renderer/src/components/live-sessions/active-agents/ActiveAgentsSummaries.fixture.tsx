import { defineFixture } from '../../../component-fixtures/component-fixture'
import { SAMPLE_NOW, sampleLiveSession } from '../live-session.test-fixture'
import { ActiveAgentsGroups } from './ActiveAgentsGroups'
import { buildActiveAgents } from './active-agents-model'

const MIN = 60_000
const SERVER = { hostId: 'gpu-box', label: 'gpu-box', kind: 'remote' as const }

const SESSIONS = [
  sampleLiveSession('asking', {
    title: 'Migrate settings storage',
    status: 'waiting-input',
    lastActivityAt: SAMPLE_NOW - MIN,
    summary: 'Needs to know whether to migrate old profiles in place.'
  }),
  sampleLiveSession('parked', {
    title: 'Refactor upload pipeline',
    status: 'waiting-subagent',
    statusDetail: '2 subagents',
    startedAt: SAMPLE_NOW - 12 * MIN,
    summary: 'Split the pipeline in three; two subagents are porting the callers.'
  }),
  sampleLiveSession('finished', {
    provider: 'codex',
    title: 'Add rate limiting to uploads',
    lastActivityAt: SAMPLE_NOW - 2 * MIN,
    summary: 'Added per-user upload rate limiting with tests.'
  }),
  sampleLiveSession('pending', {
    title: 'Fix flaky sidebar test',
    lastActivityAt: SAMPLE_NOW - 5_000,
    summaryPending: true
  }),
  sampleLiveSession('working', {
    title: 'Rebrand app icons',
    status: 'working',
    startedAt: SAMPLE_NOW - 4 * MIN
  }),
  sampleLiveSession('remote', {
    machine: SERVER,
    provider: 'codex',
    project: 'ml-experiments',
    title: 'Train tokenizer',
    status: 'waiting-input',
    lastActivityAt: SAMPLE_NOW - 3 * 60 * MIN,
    summary: 'Needs you to pick the validation dataset split.'
  })
]

function Summaries(): React.JSX.Element {
  const view = buildActiveAgents(
    SESSIONS,
    { query: '', chips: new Set(), scope: null },
    new Map(),
    SAMPLE_NOW
  )
  return (
    <div
      role="listbox"
      className="flex flex-col bg-worktree-sidebar p-2 text-worktree-sidebar-foreground"
    >
      <ActiveAgentsGroups
        view={view}
        collapsedMachines={new Set()}
        finishedOpen={false}
        hostErrors={{}}
        rowState={(session) => ({
          workspaceName: null,
          account: null,
          unread: session.id === 'asking',
          current: false,
          highlighted: false,
          picked: null,
          tabStop: session.id === 'asking'
        })}
        now={SAMPLE_NOW}
        onToggleMachine={() => {}}
        onToggleFinished={() => {}}
        onOpen={() => {}}
        onPick={() => {}}
        menu={() => null}
      />
    </div>
  )
}

export const summaries = defineFixture({
  width: 300,
  render: () => <Summaries />
})
