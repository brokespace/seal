import { defineFixture } from '../../component-fixtures/component-fixture'
import { SAMPLE_NOW, sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import { WorkspaceSessionRowList } from '../live-sessions/workspace-rows/WorkspaceSessionRows'
import { buildWorkspaceSessionRows } from '../live-sessions/workspace-rows/workspace-session-rows-model'
import { AgentSessionChatFrameView } from '../live-sessions/chat/AgentSessionChatFrame'
import { externalAgentSessionChatRows } from '../live-sessions/chat/external-agent-session-chat-rows'
import { NativeChatMessageList } from '../native-chat/NativeChatMessageList'
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

function Pane({ view, height }: { view: SessionRecapView; height: number }): React.JSX.Element {
  return (
    <div className="flex" style={{ height }}>
      <AgentSessionChatFrameView
        session={SESSION}
        isVisible
        recap={{ view, refreshing: false, refresh: () => {}, mark: () => {} }}
      >
        <NativeChatMessageList
          session={externalAgentSessionChatRows({
            agent: SESSION.provider,
            providerSessionId: SESSION.providerSessionId,
            transcript: {
              phase: 'ready',
              error: null,
              messages: SAMPLE_RECAP_TRANSCRIPT,
              readTo: null,
              hasMore: false,
              loadingEarlier: false,
              loadEarlier: async () => 'exhausted'
            },
            pending: [],
            working: false
          })}
          isVisible
          isWorking={false}
          expandSignal={false}
        />
      </AgentSessionChatFrameView>
    </div>
  )
}

/** A session reopened after three hours, with its recap beside the chat. */
export const open = defineFixture({
  width: 1180,
  render: () => <Pane view={sampleRecapView()} height={880} />,
  interact: (frame) => {
    frame.querySelector<HTMLButtonElement>('[data-live-session-panel-toggle="recap"]')?.click()
  }
})

/** The same session with the recap folded to its one line under the header. */
export const folded = defineFixture({
  width: 860,
  render: () => <Pane view={sampleRecapView()} height={560} />
})

function Panels(): React.JSX.Element {
  const noop = (): void => {}
  const panel = (
    view: SessionRecapView | null,
    server: string | null = null
  ): React.JSX.Element => (
    <div className="flex h-64 justify-self-start border border-border">
      <SessionRecapPanel
        view={view}
        refreshing={false}
        now={SAMPLE_NOW}
        server={server}
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
      {panel(
        sampleRecapView({ recap: null, state: 'unavailable', marks: {}, since: null }),
        'build-box'
      )}
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
          recap: sampleSessionRecap({
            asked: [],
            requests: [],
            did: [],
            decisions: [],
            references: []
          }),
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

const REQUESTS_ONLY = sampleSessionRecap({
  goal: null,
  standing: null,
  questions: [],
  actions: [],
  did: [],
  decisions: [],
  references: []
})

function RequestPanels(): React.JSX.Element {
  const noop = (): void => {}
  const panel = (name: string, patch: Partial<SessionRecapView>): React.JSX.Element => (
    <div data-fixture-requests={name} className="flex border border-border">
      <SessionRecapPanel
        view={sampleRecapView({ recap: REQUESTS_ONLY, since: null, ...patch })}
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
      {panel('judged', { marks: { a11: 'done', a12: 'dismissed' } })}
      <div className="flex flex-col gap-4">
        {panel('working', { turnEnded: false })}
        {panel('checking', { stale: true })}
        {panel('older-host', {
          recap: { ...REQUESTS_ONLY, requests: undefined },
          turnEnded: undefined
        })}
      </div>
    </div>
  )
}

/**
 * The Requests section in every standing: judged with the settled ones unfolded, while the agent
 * works, while the last turn is unread, and from a host that keeps no status for requests.
 */
export const requests = defineFixture({
  width: 720,
  render: () => <RequestPanels />,
  interact: (frame) => {
    frame
      .querySelector<HTMLButtonElement>(
        '[data-fixture-requests="judged"] [data-recap-section="requests"] button[aria-expanded="false"]'
      )
      ?.click()
  }
})

/**
 * The recap before it exists: being written, paused by the daily limit, not set up here, nothing
 * yet, and not set up on the server that keeps it.
 */
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
  return (
    <div
      role="listbox"
      className="flex flex-col bg-worktree-sidebar p-2 text-worktree-sidebar-foreground"
    >
      <WorkspaceSessionRowList
        worktreeId={null}
        view={buildWorkspaceSessionRows(ROWS, { machine: null, status: null }, SAMPLE_NOW)}
        finishedOpen={false}
        rowState={(session) => ({
          workspaceName: null,
          account: null,
          unread: false,
          current: session.id === 'billing',
          highlighted: false,
          picked: null
        })}
        now={SAMPLE_NOW}
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
