import { describe, expect, it } from 'vitest'
import {
  AUTO_CREATED_GRACE_MS,
  autoCreatedVerdict,
  type AutoCreatedFacts
} from './auto-created-workspaces'

const NOW = 1_000_000
const UNTOUCHED = {
  pinned: false,
  renamed: false,
  hasComment: false,
  createdInSeal: false,
  inUse: false
}

function verdict(facts: Partial<AutoCreatedFacts>) {
  return autoCreatedVerdict(
    {
      givenName: 'blog',
      displayName: 'blog',
      workspaces: [UNTOUCHED],
      runningSessions: 0,
      machineRead: true,
      emptySince: NOW - AUTO_CREATED_GRACE_MS,
      ...facts
    },
    NOW
  )
}

describe('autoCreatedVerdict', () => {
  it.each<[string, Partial<AutoCreatedFacts>, ReturnType<typeof autoCreatedVerdict>]>([
    ['its last session left and nobody touched it', {}, 'remove'],
    ['a session still runs in it', { runningSessions: 1, emptySince: null }, 'keep'],
    ['its last session left a moment ago', { emptySince: NOW - 1_000 }, 'keep'],
    ['its machine has not listed its sessions yet', { machineRead: false }, 'keep'],
    ['it was renamed', { displayName: 'Blog (old)' }, 'adopt'],
    ['its workspace was pinned', { workspaces: [{ ...UNTOUCHED, pinned: true }] }, 'adopt'],
    ['its workspace was renamed', { workspaces: [{ ...UNTOUCHED, renamed: true }] }, 'adopt'],
    ['its workspace got a comment', { workspaces: [{ ...UNTOUCHED, hasComment: true }] }, 'adopt'],
    ['a tab is open in it', { workspaces: [{ ...UNTOUCHED, inUse: true }] }, 'keep'],
    ['its checkout has worktrees of its own', { workspaces: [UNTOUCHED, UNTOUCHED] }, 'remove'],
    [
      'a workspace was added to it',
      { workspaces: [UNTOUCHED, { ...UNTOUCHED, createdInSeal: true }] },
      'adopt'
    ],
    [
      'it was touched while a session still runs',
      { runningSessions: 2, emptySince: null, displayName: 'Mine' },
      'adopt'
    ]
  ])('when %s', (_name, facts, expected) => {
    expect(verdict(facts)).toBe(expected)
  })
})
