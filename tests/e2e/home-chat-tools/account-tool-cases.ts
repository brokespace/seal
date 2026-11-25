import { expect } from '@stablyai/playwright-test'
import {
  fakeClaudeAccessToken,
  fakeCodexAccessToken,
  fakeCodexAuthJson
} from '../helpers/seal-fake-account-clis'
import { serveFakeAccountUsage } from '../helpers/seal-fake-usage-endpoints'
import { expectError, expectOk, sharedFlow } from './tool-case-support'
import type { ToolCases, ToolEnv } from './tool-case-types'

const WORK = { email: 'brian@acme.dev', organizationUuid: 'org-acme', organizationName: 'Acme' }
const PERSONAL = {
  email: 'brian@example.com',
  organizationUuid: 'org-personal',
  organizationName: 'Personal'
}
const CODEX = { email: 'brian@acme.dev', accountId: 'acct-acme', plan: 'pro' } as const

function claudeCredential(login: typeof WORK): Record<string, unknown> {
  return {
    provider: 'claude',
    ...login,
    credentialsJson: JSON.stringify({
      claudeAiOauth: {
        accessToken: fakeClaudeAccessToken(login.email),
        refreshToken: `claude-refresh-${login.email}`,
        expiresAt: Date.now() + 365 * 24 * 3600 * 1000,
        scopes: ['user:inference', 'user:profile'],
        subscriptionType: 'max'
      }
    }),
    oauthAccountJson: JSON.stringify({
      emailAddress: login.email,
      organizationUuid: login.organizationUuid,
      organizationName: login.organizationName
    })
  }
}

/** Two Claude logins and a Codex login, saved the way a login copied from another machine is. */
const accounts = sharedFlow(async (env) => {
  await serveFakeAccountUsage(env.app, {
    [fakeClaudeAccessToken(WORK.email)]: { session: 42, weekly: 18 },
    [fakeClaudeAccessToken(PERSONAL.email)]: { session: 7, weekly: 3 },
    [fakeCodexAccessToken(CODEX.email)]: { session: 12, weekly: 55, plan: 'pro' }
  })
  for (const params of [
    claudeCredential(WORK),
    claudeCredential(PERSONAL),
    { provider: 'codex', authJson: fakeCodexAuthJson(CODEX) }
  ]) {
    const response = await env.page.evaluate(
      (credential) =>
        window.api.runtime.call({ method: 'seal.accounts.importCredential', params: credential }),
      params
    )
    expect(response).toMatchObject({ ok: true })
  }
})

async function accountUsage(env: ToolEnv): Promise<void> {
  await accounts(env)
  const { outcomes } = await env.call([
    { name: 'account_usage', args: { refresh: true } },
    { name: 'account_usage', args: { provider: 'codex' } }
  ])
  const all = expectOk(outcomes[0])
  expect(all).toMatch(
    /claude accounts:\n(?:.*\n)*?- brian@acme\.dev \[key \S+, .*\].*\n {2}session: 42% used, resets \S+; weekly: 18% used, resets \S+/
  )
  expect(all).toMatch(
    /- brian@example\.com \[key \S+, .*\].*\n {2}session: 7% used, resets \S+; weekly: 3% used, resets \S+/
  )
  // Codex usage is read with the machine's codex CLI, which this machine does not have.
  expect(all).toContain(
    'codex accounts:\n- brian@acme.dev [key codex:brian@acme.dev#acct-acme, oauth] (ACTIVE)'
  )
  const codex = expectOk(outcomes[1])
  expect(codex.startsWith('codex accounts:\n')).toBe(true)
  expect(codex).not.toContain('claude accounts:')
}

function activeClaude(usage: string): string[] {
  return usage
    .split('\n')
    .filter((line) => line.startsWith('- ') && line.includes('ACTIVE'))
    .map((line) => line.slice(2, line.indexOf(' [key ')))
}

async function switchAccount(env: ToolEnv): Promise<void> {
  await accounts(env)
  const before = await env.call([{ name: 'account_usage', args: { provider: 'claude' } }])
  const first = activeClaude(expectOk(before.outcomes[0]))[0]
  const other = first === PERSONAL.email ? WORK.email : PERSONAL.email

  const declined = await env.call(
    [
      { name: 'switch_account', args: { provider: 'claude', account: other } },
      { name: 'account_usage', args: { provider: 'claude' } }
    ],
    { approve: false }
  )
  expect(declined.outcomes[0].status).toBe('denied')
  expect(activeClaude(expectOk(declined.outcomes[1]))).toEqual([first])

  const { outcomes } = await env.call([
    { name: 'switch_account', args: { provider: 'claude', account: other } },
    { name: 'account_usage', args: { provider: 'claude' } },
    { name: 'switch_account', args: { provider: 'claude', account: other } },
    { name: 'switch_account', args: { provider: 'claude', account: 'nobody@nowhere.invalid' } }
  ])
  expect(outcomes[0].askedApproval).toBe(true)
  expect(expectOk(outcomes[0])).toBe(
    `${other} is now the active claude account; new sessions launch on it.`
  )
  expect(activeClaude(expectOk(outcomes[1]))).toEqual([other])
  expect(expectOk(outcomes[2])).toBe(`${other} is already the active claude account.`)
  expect(expectError(outcomes[3])).toContain('No account matches "nobody@nowhere.invalid"')
}

export const ACCOUNT_TOOL_CASES: ToolCases = {
  account_usage: { scope: 'app', run: accountUsage },
  switch_account: { scope: 'app', run: switchAccount }
}
