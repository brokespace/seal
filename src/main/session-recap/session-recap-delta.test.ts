import { describe, expect, it } from 'vitest'
import { parseRecapDelta } from './session-recap-delta'

describe('parseRecapDelta', () => {
  it('reads the object out of a code fence and prose around it', () => {
    const result = parseRecapDelta(
      'Here is the update:\n```json\n{"title": "**Fix login redirect**", "resolve": ["q2"]}\n```\nDone.'
    )

    expect(result).toEqual({
      ok: true,
      delta: {
        title: 'Fix login redirect',
        goal: null,
        standing: null,
        add: { asked: [], did: [], questions: [], ignored: [], actions: [], decisions: [] },
        update: [],
        resolve: ['q2']
      }
    })
  })

  it('drops a wrong item and a wrong field without losing the rest', () => {
    const result = parseRecapDelta(
      JSON.stringify({
        goal: 42,
        add: {
          actions: [{ text: 'Set CLOUDFLARE_API_TOKEN', ref: '[m4]' }, { ref: 'm5' }, 'run it'],
          did: [{ text: 'Wrote the migration', state: 'finished' }],
          questions: 'none'
        },
        update: [{ id: 'w3', state: 'blocked' }, { state: 'done' }]
      })
    )

    expect(result.ok && result.delta).toEqual({
      title: null,
      goal: null,
      standing: null,
      add: {
        asked: [],
        did: [{ text: 'Wrote the migration', ref: null, state: 'done' }],
        questions: [],
        ignored: [],
        actions: [{ text: 'Set CLOUDFLARE_API_TOKEN', ref: 'm4' }],
        decisions: []
      },
      update: [{ id: 'w3', state: 'blocked' }],
      resolve: []
    })
  })

  it.each([
    ['prose', 'I updated the recap as asked.'],
    ['cut-off JSON', '{"title": "Fix login", "add": {"asked": [{"text": "Fix'],
    ['an object that is not a delta', '{"summary": "Fixed the login redirect"}']
  ])('rejects %s', (_name, reply) => {
    expect(parseRecapDelta(reply).ok).toBe(false)
  })
})
