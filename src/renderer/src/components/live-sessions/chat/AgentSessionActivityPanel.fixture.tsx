import { defineFixture } from '../../../component-fixtures/component-fixture'
import { SAMPLE_NOW } from '../live-session.test-fixture'
import { AgentSessionActivityPanel } from './AgentSessionActivityPanel'

const watcher = (id: string, label: string, status: 'running' | 'completed') => ({
  id,
  label,
  status,
  startedAt: SAMPLE_NOW - 4 * 60_000,
  summary: null
})

/** A turn that ended with two watchers still running, and one that has finished. */
export const leftoversRunning = defineFixture({
  width: 320,
  render: () => (
    <div className="flex h-80">
      <AgentSessionActivityPanel
        panel="tasks"
        provider="claude"
        activity={{
          subagents: [],
          todos: [],
          tasks: [
            watcher('bash_1', 'while true; do nvidia-smi; sleep 30; done', 'running'),
            watcher('bash_2', 'while true; do tail -n 1 train.log; sleep 60; done', 'running'),
            watcher('bash_3', 'pnpm build', 'completed')
          ]
        }}
        openSubagentId={null}
        onOpenSubagent={() => undefined}
        onClose={() => undefined}
        now={SAMPLE_NOW}
      />
    </div>
  )
})

const subagent = (id: string, title: string, status: 'running' | 'completed' | 'failed') => ({
  id,
  title,
  agentType: 'general-purpose',
  model: null,
  status,
  background: false,
  activity: status === 'running' ? 'Grep: runningSubagents' : null,
  startedAt: SAMPLE_NOW - 6 * 60_000,
  lastActivityAt: SAMPLE_NOW - 60_000,
  transcriptPath: '/tmp/agent.jsonl'
})

/** One subagent still running; two that ended fold under Previous. */
export const subagentsRunningAndEnded = defineFixture({
  width: 320,
  render: () => (
    <div className="flex h-80">
      <AgentSessionActivityPanel
        panel="subagents"
        provider="claude"
        activity={{
          subagents: [
            subagent('a1', 'Find badge call sites', 'running'),
            subagent('a2', 'Review the diff', 'completed'),
            subagent('a3', 'Run e2e suite', 'failed')
          ],
          todos: [],
          tasks: []
        }}
        openSubagentId={null}
        onOpenSubagent={() => undefined}
        onClose={() => undefined}
        now={SAMPLE_NOW}
      />
    </div>
  )
})

/** The same session with Previous opened. */
export const subagentsEndedExpanded = defineFixture({
  width: 320,
  render: () => (
    <div className="flex h-80">
      <AgentSessionActivityPanel
        panel="subagents"
        provider="claude"
        activity={{
          subagents: [
            subagent('a1', 'Find badge call sites', 'running'),
            subagent('a2', 'Review the diff', 'completed'),
            subagent('a3', 'Run e2e suite', 'failed')
          ],
          todos: [],
          tasks: []
        }}
        openSubagentId={null}
        onOpenSubagent={() => undefined}
        onClose={() => undefined}
        now={SAMPLE_NOW}
      />
    </div>
  ),
  interact: (frame) => {
    frame.querySelector<HTMLButtonElement>('[data-live-subagents-ended] button')?.click()
  }
})
