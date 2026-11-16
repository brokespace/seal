import { defineFixture } from '../../../component-fixtures/component-fixture'
import { SAMPLE_NOW } from '../live-session.test-fixture'
import { LiveSessionActivityPanel } from './LiveSessionActivityPanel'

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
      <LiveSessionActivityPanel
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
