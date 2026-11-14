import { describe, expect, it } from 'vitest'
import { SealNextLaunchAccounts } from './seal-next-launch-account'

const WORK = 'claude:work@example.com'

describe('SealNextLaunchAccounts', () => {
  it('routes only the next launch of that agent in that project', () => {
    const choices = new SealNextLaunchAccounts(() => 1_000)
    choices.set('repo-1', 'claude', WORK)

    expect(choices.take('repo-2::/srv/other', 'claude')).toBeNull()
    expect(choices.take('repo-1::/srv/app', 'codex')).toBeNull()
    expect(choices.take('repo-1::/srv/app/worktrees/new', 'claude')).toBe(WORK)
    expect(choices.take('repo-1::/srv/app', 'claude')).toBeNull()
  })

  it('drops a choice whose session never started', () => {
    let now = 1_000
    const choices = new SealNextLaunchAccounts(() => now)
    choices.set('repo-1', 'claude', WORK)

    now += 11 * 60_000

    expect(choices.take('repo-1::/srv/app', 'claude')).toBeNull()
  })
})
