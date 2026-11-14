import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { foldClaudeActivity, newClaudeActivityState } from './claude-transcript-activity'
import { recordsOf } from './transcript-records'

// Captured live: an approval prompt held both launches, so their results came scans after the calls.
const records = recordsOf(
  readFileSync(join(__dirname, '__fixtures__', 'live-claude-subagents-approved.jsonl'), 'utf8'),
  false
)

it('a background subagent whose launch result arrives a scan after its call is still running', () => {
  const state = newClaudeActivityState()
  const beforeTheResults = records.slice(0, 4)

  foldClaudeActivity(state, beforeTheResults)
  foldClaudeActivity(state, records)

  expect(
    [...state.agents.values()].map((agent) => [agent.title, agent.status, agent.background])
  ).toEqual([
    ['Audit the auth module', 'running', true],
    ['Audit the billing module', 'running', true]
  ])
})
