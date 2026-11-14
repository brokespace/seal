import { defineFixture } from '../../component-fixtures/component-fixture'
import { ActiveAgentsGroups } from '../live-sessions/active-agents/ActiveAgentsGroups'
import { buildActiveAgents } from '../live-sessions/active-agents/active-agents-model'
import { SAMPLE_NOW, sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import { LiveSessionPaneView } from '../live-sessions/workspace/LiveSessionPane'
import type { LiveSessionPanel } from '../live-sessions/workspace/live-session-tabs-store'
import type { SessionRecapView } from '../../../../shared/session-recap/session-recap-types'
import {
  SAMPLE_RECAP_BRIEF,
  SAMPLE_RECAP_TRANSCRIPT,
  sampleRecapView,
  sampleSessionRecap
} from './session-recap.test-fixture'
import { SessionRecapPanel } from './SessionRecapPanel'

const MIN = 60_000
const SESSION = sampleLiveSession('billing', {
  title: 'why were some customers charged twice last week',
  cwd: '/code/billing',
  project: 'billing',
  status: 'waiting-input',
  lastActivityAt: SAMPLE_NOW - 30 * MIN,
  recap: SAMPLE_RECAP_BRIEF
})

function Pane({
  panel,
  view,
  height
}: {
  panel: LiveSessionPanel | null
  view: SessionRecapView
  height: number
}): React.JSX.Element {
  return (
    <div className="flex" style={{ height }}>
      <LiveSessionPaneView
        session={SESSION}
        transcript={{
          phase: 'ready',
          error: null,
          messages: SAMPLE_RECAP_TRANSCRIPT,
          hasMore: false,
          loadingEarlier: false,
          loadEarlier: async () => 'exhausted'
        }}
        subagentTranscript={null}
        messages={[]}
        panel={panel}
        onPanel={() => {}}
        openSubagentId={null}
        onOpenSubagent={() => {}}
        onSend={() => {}}
        onRetry={() => {}}
        onAnswer={() => {}}
        answering={null}
        now={SAMPLE_NOW}
        recap={{
          view,
          refreshing: false,
          refresh: () => {},
          mark: () => {},
          onOpenLink: () => {},
          onOpenSettings: () => {}
        }}
      />
    </div>
  )
}

/** A session reopened after three hours, with its recap beside the chat. */
export const open = defineFixture({
  width: 1180,
  render: () => <Pane panel="recap" view={sampleRecapView()} height={880} />
})

/** The same session with the recap folded to its one line under the header. */
export const folded = defineFixture({
  width: 860,
  render: () => <Pane panel={null} view={sampleRecapView()} height={560} />
})

function Panels(): React.JSX.Element {
  const noop = (): void => {}
  const panel = (view: SessionRecapView | null, refreshing = false): React.JSX.Element => (
    <div className="flex h-64 justify-self-start border border-border">
      <SessionRecapPanel
        view={view}
        refreshing={refreshing}
        now={SAMPLE_NOW}
        onRefresh={noop}
        onMark={noop}
        onJump={noop}
        onOpenLink={noop}
        onOpenSettings={noop}
        onClose={noop}
      />
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-4 bg-background p-4">
      {panel(sampleRecapView({ recap: null, state: 'updating', marks: {}, since: null }))}
      {panel(
        sampleRecapView({
          recap: null,
          state: 'paused',
          pausedUntil: SAMPLE_NOW + 5 * 60 * MIN,
          marks: {},
          since: null
        })
      )}
      {panel(sampleRecapView({ recap: null, state: 'unavailable', marks: {}, since: null }))}
      {panel(sampleRecapView({ recap: null, state: 'empty', marks: {}, since: null }))}
    </div>
  )
}

function PanelHalves(): React.JSX.Element {
  const noop = (): void => {}
  const half = (view: SessionRecapView): React.JSX.Element => (
    <div className="flex border border-border">
      <SessionRecapPanel
        view={view}
        refreshing={false}
        now={SAMPLE_NOW}
        onRefresh={noop}
        onMark={noop}
        onJump={noop}
        onOpenLink={noop}
        onClose={noop}
      />
    </div>
  )
  return (
    <div className="flex items-start gap-4 bg-background p-4">
      {half(
        sampleRecapView({
          recap: sampleSessionRecap({ asked: [], did: [], decisions: [], references: [] }),
          since: null
        })
      )}
      {half(
        sampleRecapView({
          recap: sampleSessionRecap({
            goal: null,
            standing: null,
            questions: [],
            actions: [],
            ignored: []
          }),
          since: null
        })
      )}
    </div>
  )
}

/** The recap's sections, the top half beside the bottom half so none is scrolled away. */
export const sections = defineFixture({
  width: 720,
  render: () => <PanelHalves />
})

/** The recap before it exists: being written, paused by the daily limit, not set up, nothing yet. */
export const states = defineFixture({
  width: 720,
  render: () => <Panels />
})

const ROWS = [
  sampleLiveSession('billing', {
    title: 'why were some customers charged twice last week',
    project: 'billing',
    status: 'waiting-input',
    lastActivityAt: SAMPLE_NOW - 30 * MIN,
    summary: 'Needs to know whether the backfill should refund duplicates automatically.',
    recap: SAMPLE_RECAP_BRIEF
  }),
  sampleLiveSession('named', {
    title: 'look at the flaky sidebar test',
    customTitle: 'Sidebar flake hunt',
    lastActivityAt: SAMPLE_NOW - 2 * 60 * MIN,
    summary: 'Pinned the flake to an unawaited resize observer and fixed it.',
    recap: { title: 'Fix flaky sidebar resize test', rev: 4, questions: 0, actions: 1 }
  }),
  sampleLiveSession('clean', {
    provider: 'codex',
    title: 'add rate limiting',
    lastActivityAt: SAMPLE_NOW - 26 * 60 * MIN,
    summary: 'Added per-user upload rate limiting with tests.',
    recap: { title: 'Rate-limit uploads per user', rev: 7, questions: 0, actions: 0 }
  }),
  sampleLiveSession('fresh', {
    title: 'can you check why the deploy is red',
    status: 'working',
    startedAt: SAMPLE_NOW - 3 * MIN
  })
]

function Rows(): React.JSX.Element {
  const view = buildActiveAgents(
    ROWS,
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
          unread: false,
          current: session.id === 'billing',
          highlighted: false,
          picked: null,
          tabStop: session.id === 'billing'
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

/** Session rows: a recap title where the user set no name, his own name where he did, and the badge. */
export const rows = defineFixture({
  width: 300,
  render: () => <Rows />
})
