import { describe, expect, it } from 'vitest'
import { planSealAccountDedup, type SealDedupEntry } from './seal-account-dedup'

function entry(id: string, key: string, patch: Partial<SealDedupEntry> = {}): SealDedupEntry {
  return { id, key, active: false, usable: true, freshness: 100, lastAuthenticatedAt: 1, ...patch }
}

describe('planSealAccountDedup', () => {
  it('collapses copies of one login to the newest usable one and re-points the selection', () => {
    const plan = planSealAccountDedup([
      entry('stale-selected', 'claude:brian@x.io', { active: true, freshness: 100 }),
      entry('fresh', 'claude:Brian@x.io#org-1', { freshness: 900 }),
      entry('signed-out', 'claude:brian@x.io#org-1', { usable: false, freshness: null }),
      entry('other-person', 'claude:sam@x.io')
    ])
    expect(plan).toEqual([
      {
        key: 'claude:Brian@x.io#org-1',
        keep: 'fresh',
        remove: ['stale-selected', 'signed-out'],
        reselect: true
      }
    ])
  })

  it('keeps the selected copy when the tokens are equally fresh', () => {
    const plan = planSealAccountDedup([
      entry('first', 'codex:a@x.io', { lastAuthenticatedAt: 50 }),
      entry('selected', 'codex:a@x.io', { active: true, lastAuthenticatedAt: 10 })
    ])
    expect(plan).toEqual([
      { key: 'codex:a@x.io', keep: 'selected', remove: ['first'], reselect: false }
    ])
  })

  it('leaves one email in two organizations, on two providers, and API keys as separate accounts', () => {
    expect(
      planSealAccountDedup([
        entry('personal', 'claude:a@x.io#org-personal'),
        entry('work', 'claude:a@x.io#org-work'),
        entry('codex', 'codex:a@x.io'),
        entry('key-1', 'claude-key:k1'),
        entry('key-2', 'claude-key:k2')
      ])
    ).toEqual([])
  })
})
