import { describe, expect, it } from 'vitest'
import { keepMcpSignIns, planMcpSignIns } from './claude-profile-mcp-sign-ins'

const SLACK = 'plugin:slack:slack|38801a7d845718b3'
const JIRA = 'plugin:atlassian:atlassian|65c63eb8da6de8b7'
const stub = { serverName: 'slack', accessToken: '' }
const signedIn = (token: string, expiresAt: number) => ({ accessToken: token, expiresAt })

describe('planMcpSignIns', () => {
  it('gives a profile the default home sign-in in place of its empty stub', () => {
    const plan = planMcpSignIns({
      defaults: { [SLACK]: signedIn('a', 100) },
      profile: { [SLACK]: stub },
      synced: [],
      writeDefaults: true
    })
    expect(plan.profile[SLACK]).toEqual(signedIn('a', 100))
    expect(plan.adopted).toEqual(['plugin:slack:slack'])
    expect(plan.synced).toEqual([SLACK])
  })

  it('keeps the later expiry on both sides when a profile refreshed a rotating token', () => {
    const plan = planMcpSignIns({
      defaults: { [JIRA]: signedIn('old', 100) },
      profile: { [JIRA]: signedIn('new', 200) },
      synced: [JIRA],
      writeDefaults: true
    })
    expect(plan.profile[JIRA]).toEqual(signedIn('new', 200))
    expect(plan.defaults[JIRA]).toEqual(signedIn('new', 200))
  })

  it('leaves the default home alone when it cannot be written', () => {
    const plan = planMcpSignIns({
      defaults: {},
      profile: { [JIRA]: signedIn('own', 200) },
      synced: [],
      writeDefaults: false
    })
    expect(plan.defaults).toEqual({})
    expect(plan.profile[JIRA]).toEqual(signedIn('own', 200))
  })

  it('signs the profile out of a server the default home signed out of', () => {
    const plan = planMcpSignIns({
      defaults: {},
      profile: { [SLACK]: signedIn('a', 100) },
      synced: [SLACK],
      writeDefaults: true
    })
    expect(plan.profile).toEqual({})
    expect(plan.defaults).toEqual({})
    expect(plan.synced).toEqual([])
  })
})

describe('keepMcpSignIns', () => {
  it('keeps a server sign-in only the overwritten home holds', () => {
    const login = JSON.stringify({ claudeAiOauth: { accessToken: 'new' } })
    const copy = JSON.stringify({
      claudeAiOauth: { accessToken: 'old' },
      mcpOAuth: { [SLACK]: signedIn('a', 100) }
    })
    expect(JSON.parse(keepMcpSignIns(login, copy))).toEqual({
      claudeAiOauth: { accessToken: 'new' },
      mcpOAuth: { [SLACK]: signedIn('a', 100) }
    })
  })
})
