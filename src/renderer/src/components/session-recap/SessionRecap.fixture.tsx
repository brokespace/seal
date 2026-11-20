import { defineFixture } from '../../component-fixtures/component-fixture'
import { SAMPLE_NOW, sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import { WorkspaceSessionRowList } from '../live-sessions/workspace-rows/WorkspaceSessionRows'
import { buildWorkspaceSessionRows } from '../live-sessions/workspace-rows/workspace-session-rows-model'
import { AgentSessionChatFrameView } from '../live-sessions/chat/AgentSessionChatFrame'
import { externalAgentSessionChatRows } from '../live-sessions/chat/external-agent-session-chat-rows'
import { NativeChatMessageList } from '../native-chat/NativeChatMessageList'
import type {
  SessionRecapUnavailableReason,
  SessionRecapView
} from '../../../../shared/session-recap/session-recap-types'
import type { SessionSummariesStatus } from '../../../../shared/session-summaries/session-summary-contracts'
import type { UsageCredentialHost } from '../settings/accounts/usage/usage-credential-host'
import {
  fixtureProviderStatuses,
  stubUtilityModelFixtureHost
} from '../settings/accounts/utility-model/utility-model-fixture-host'
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
        recap={{ view, refreshing: false, failed: null, refresh: () => {}, mark: () => {} }}
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

const BUILD_BOX: UsageCredentialHost = {
  owner: { kind: 'environment', environmentId: 'build-box' },
  label: 'build-box'
}

function Panels(): React.JSX.Element {
  const noop = (): void => {}
  const panel = (view: SessionRecapView | null, host?: UsageCredentialHost): React.JSX.Element => (
    <div className="flex h-64 justify-self-start border border-border">
      <SessionRecapPanel
        view={view}
        refreshing={false}
        now={SAMPLE_NOW}
        host={host}
        onRefresh={noop}
        onMark={noop}
        onJump={noop}
        onOpenLink={noop}
        onClose={noop}
      />
    </div>
  )
  const none = { recap: null, marks: {}, since: null }
  return (
    <div className="grid grid-cols-2 gap-4 bg-background p-4">
      {panel(sampleRecapView({ ...none, state: 'updating' }))}
      {panel(sampleRecapView({ ...none, state: 'paused', pausedUntil: SAMPLE_NOW + 5 * 60 * MIN }))}
      {panel(sampleRecapView({ ...none, state: 'empty' }))}
      {panel(
        sampleRecapView({
          ...none,
          state: 'empty',
          unavailableReason: { kind: 'transcript-unreadable' }
        }),
        BUILD_BOX
      )}
      {panel(
        sampleRecapView({
          ...none,
          state: 'failed',
          failure: 'The server that runs this session did not answer',
          unavailableReason: { kind: 'server-unreachable', message: 'Request timed out' }
        }),
        BUILD_BOX
      )}
      {panel(sampleRecapView({ ...none, state: 'unavailable' }), BUILD_BOX)}
    </div>
  )
}

function UnavailablePanel({
  reason,
  host
}: {
  reason: SessionRecapUnavailableReason
  host: UsageCredentialHost
}): React.JSX.Element {
  const noop = (): void => {}
  return (
    <div className="flex h-[640px] w-[420px] border border-border">
      <SessionRecapPanel
        view={sampleRecapView({
          recap: null,
          marks: {},
          since: null,
          state: 'unavailable',
          unavailableReason: reason
        })}
        refreshing={false}
        now={SAMPLE_NOW}
        host={host}
        onRefresh={noop}
        onMark={noop}
        onJump={noop}
        onOpenLink={noop}
        onClose={noop}
      />
    </div>
  )
}

const FIXTURE_PROVIDERS = fixtureProviderStatuses({
  'cloudflare-workers-ai': { configured: false },
  claude: { configured: true, source: 'agent-cli' }
})

function serverSettings(status: Partial<SessionSummariesStatus>): () => void {
  return stubUtilityModelFixtureHost({
    providers: FIXTURE_PROVIDERS,
    summaries: {
      enabled: true,
      recapEnabled: true,
      configured: true,
      recapConfigured: true,
      pausedUntil: null,
      recapPausedUntil: null,
      ...status
    }
  })
}

/** The server keeps recaps off: the switch is in the tab, and flips on that server. */
export const recapsOffOnServer = defineFixture({
  width: 460,
  setup: serverSettings({ recapEnabled: false }),
  render: () => <UnavailablePanel reason={{ kind: 'recaps-off' }} host={BUILD_BOX} />
})

/** The server has no account for the recap provider: its provider rows are in the tab. */
export const providerNotSetUpOnServer = defineFixture({
  width: 460,
  setup: serverSettings({ recapConfigured: false, configured: false }),
  render: () => (
    <UnavailablePanel
      reason={{ kind: 'provider-not-set-up', provider: 'cloudflare-workers-ai' }}
      host={BUILD_BOX}
    />
  )
})

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
 * The recap before it exists: being written, paused by the daily limit, nothing yet, a transcript
 * the server cannot read, a server that did not answer, and a server with no reason to give.
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
        view={buildWorkspaceSessionRows(ROWS, SAMPLE_NOW)}
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
