import { expect, it } from 'vitest'
import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import { homeChatTranscriptRows } from './home-chat-transcript-rows'

let ord = 0
function entry<Fields>(
  fields: Fields
): Fields & { id: string; rev: number; at: number; ord: number } {
  ord += 1
  return { id: `e${ord}`, rev: 1, at: 1_000 * ord, ord, ...fields }
}

const tool = { kind: 'tool', tool: 'run_command', input: {}, status: 'ok' } as const

it('draws a thread as transcript messages, grouped calls and one action holder per response', () => {
  ord = 0
  const entries: HomeChatEntry[] = [
    entry({ kind: 'user', text: 'Check the disk', delivery: 'delivered' }),
    entry({ kind: 'thinking', text: 'Which machine?', streaming: false, durationMs: 2_000 }),
    entry({ kind: 'assistant', text: 'Looking.', streaming: false }),
    entry(tool),
    entry(tool),
    entry({ kind: 'assistant', text: 'It is at 71%.', streaming: false }),
    entry({ kind: 'user', text: 'Thanks', delivery: 'delivered' }),
    entry({ kind: 'progress', text: 'Saving a note' }),
    entry({ kind: 'assistant', text: 'Noted.', streaming: true })
  ]
  const rows = homeChatTranscriptRows(entries)

  expect(
    rows.map((row) =>
      row.kind === 'message'
        ? [row.message.role, row.message.id, row.endsResponse, row.latestResponse]
        : row.kind === 'tools'
          ? ['tools', row.entries.map((call) => call.id)]
          : [row.entry.kind]
    )
  ).toEqual([
    ['user', 'e1', false, false],
    ['reasoning', 'e2', false, false],
    ['assistant', 'e3', false, false],
    ['tools', ['e4', 'e5']],
    ['assistant', 'e6', true, false],
    ['user', 'e7', false, false],
    ['progress'],
    ['assistant', 'e9', true, true]
  ])
  expect(rows[1]).toMatchObject({
    message: { timestamp: 2_000, completedAt: 4_000, state: 'completed' }
  })
  expect(rows[7]).toMatchObject({ message: { state: 'running' } })
})
