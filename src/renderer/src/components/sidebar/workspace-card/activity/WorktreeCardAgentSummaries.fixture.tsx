import { defineFixture } from '../../../../component-fixtures/component-fixture'
import WorktreeCardAgents from './WorktreeCardAgents'
import { buildWorktreeAgentRows } from './worktree-agent-rows'
import type { AgentStatusEntry } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import type { LiveSession } from '../../../../../../shared/live-sessions/live-session-types'
import type { TerminalTab } from '../../../../../../shared/workspace-layout/terminal-tab-types'

const now = Date.now()
const MIN = 60_000
const WORKTREE = 'summaries-worktree'

type Agent = {
  id: string
  agentType: AgentStatusEntry['agentType']
  state: AgentStatusEntry['state']
  prompt: string
  lastAssistantMessage: string
  summary?: string
}

const AGENTS: Agent[] = [
  {
    id: 'asking',
    agentType: 'claude',
    state: 'waiting',
    prompt: 'Migrate settings storage',
    lastAssistantMessage:
      'I found two places that still read the legacy JSON file. Before I remove them I need to know whether older profiles should be migrated in place or left untouched.',
    summary: 'Needs to know whether to migrate old profiles in place.'
  },
  {
    id: 'finished',
    agentType: 'codex',
    state: 'done',
    prompt: 'Add rate limiting to uploads',
    lastAssistantMessage:
      'All done. I added a token bucket per user in upload-limits.ts, wired it into the handler and covered the burst and refill paths with tests.',
    summary: 'Added per-user upload rate limiting with tests.'
  },
  {
    id: 'no-summary',
    agentType: 'claude',
    state: 'done',
    prompt: 'Fix flaky sidebar test',
    lastAssistantMessage: 'Waiting on hydration in the test setup fixes it: 20 runs in a row pass.'
  }
]

function paneKey(agent: Agent): string {
  return `${agent.id}-tab:11111111-1111-4111-8111-111111111111`
}

function rows() {
  const tabs: TerminalTab[] = AGENTS.map((agent, index) => ({
    id: `${agent.id}-tab`,
    ptyId: null,
    worktreeId: WORKTREE,
    title: agent.agentType ?? 'agent',
    customTitle: null,
    color: null,
    sortOrder: index,
    createdAt: now
  }))
  const entries: AgentStatusEntry[] = AGENTS.map((agent, index) => ({
    paneKey: paneKey(agent),
    worktreeId: WORKTREE,
    tabId: `${agent.id}-tab`,
    agentType: agent.agentType,
    state: agent.state,
    prompt: agent.prompt,
    lastAssistantMessage: agent.lastAssistantMessage,
    updatedAt: now - (index + 1) * MIN,
    stateStartedAt: now - (index + 1) * MIN,
    stateHistory: []
  }))
  return buildWorktreeAgentRows({ tabs, entries, retained: [], now })
}

// The registry is where a pane's summary arrives; the rows read it from there.
function setup(): void {
  const sessions = AGENTS.flatMap((agent) =>
    agent.summary
      ? [
          {
            id: `local:${agent.id}`,
            provider: agent.agentType === 'codex' ? 'codex' : 'claude',
            providerSessionId: agent.id,
            machine: { hostId: 'local', label: 'brian-mbp', kind: 'local' },
            origin: 'seal',
            cwd: '/Users/brian/code/seal',
            project: 'seal',
            title: agent.prompt,
            status: 'waiting-input',
            statusSource: 'seal-hooks',
            statusDetail: null,
            lastActivityAt: now,
            startedAt: now,
            alive: true,
            pid: 1,
            transcriptPath: null,
            inputRoutes: [{ kind: 'seal-pane', paneKey: paneKey(agent) }],
            permission: null,
            summary: agent.summary
          } satisfies LiveSession
        ]
      : []
  )
  window.api.liveSessions = {
    ...window.api.liveSessions,
    onEvent: () => () => {},
    onMessage: () => () => {},
    snapshot: async () => ({ revision: 1, sessions, hostErrors: {} }),
    messages: async () => []
  }
}

/** Stopped agents: two show the host's one-line summary, the third its raw last message. */
export const summaries = defineFixture({
  width: 400,
  store: { agentActivityDisplayMode: 'compact' },
  setup,
  render: () => (
    <div className="flex flex-col gap-0.5 bg-sidebar p-2 text-sidebar-foreground">
      <WorktreeCardAgents worktreeId={WORKTREE} agents={rows()} />
    </div>
  ),
  // Several agents collapse into one strip; open it to show their rows.
  interact: async (frame) => {
    const toggle = frame.querySelector<HTMLElement>('[data-compact-agent-list] [aria-expanded]')
    if (toggle?.getAttribute('aria-expanded') === 'false') {
      toggle.click()
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
})
