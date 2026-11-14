import { describe, expect, it } from 'vitest'
import { liveSessionLabel } from './live-session-label'

const session = {
  title: 'fix the thing in the login page that redirects',
  project: 'seal',
  recap: { title: 'Fix login redirect loop' }
}

describe('liveSessionLabel', () => {
  it("shows the recap's title in place of the first prompt", () => {
    expect(liveSessionLabel(session)).toBe('Fix login redirect loop')
  })

  it('keeps the name the user set in Seal', () => {
    expect(liveSessionLabel({ ...session, customTitle: 'Login bug' })).toBe('Login bug')
  })

  it('keeps the name the user set in the agent', () => {
    expect(liveSessionLabel({ ...session, title: 'auth work', titleNamed: true })).toBe('auth work')
  })

  it("falls back to the provider's title while the recap has none", () => {
    expect(liveSessionLabel({ ...session, recap: { title: null } })).toBe(
      'fix the thing in the login page that redirects'
    )
  })
})
