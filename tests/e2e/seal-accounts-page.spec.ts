// Drives Settings > Accounts in the real app against stand-in `claude` and `codex` CLIs.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { runProcess } from '@orca/process-host'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { expect, test } from './helpers/orca-app'
import {
  createSealFakeAccountClis,
  FAKE_CLAUDE_SIGN_IN_LINK,
  FAKE_CODEX_DEVICE_CODE,
  fakeClaudeAccessToken,
  fakeCodexAccessToken,
  isProcessAlive,
  writeFakeClaudeSystemLogin,
  writeFakeCodexSystemLogin,
  type FakeClaudeLogin
} from './helpers/seal-fake-account-clis'
import { serveFakeAccountUsage } from './helpers/seal-fake-usage-endpoints'
import {
  claudeUsageAtLimit,
  claudeUsageCheckThrottled,
  claudeUsageNearLimit,
  claudeUsageWithRoom
} from '../../src/main/rate-limits/providers/claude/claude-oauth-usage-responses.test-fixture'

test.skip(process.platform === 'win32', 'the stand-in CLIs are POSIX scripts')

const clis = createSealFakeAccountClis()
test.use({ launchEnv: clis.env })
test.afterAll(() => clis.dispose())

const WORK: FakeClaudeLogin = {
  email: 'brian@acme.dev',
  organizationUuid: 'org-acme',
  organizationName: 'Acme',
  code: 'acme-code#SEAL_E2E'
}
const PERSONAL: FakeClaudeLogin = {
  email: 'brian@example.com',
  organizationUuid: 'org-personal',
  organizationName: 'Personal',
  code: 'personal-code#SEAL_E2E'
}
const CODEX = { email: 'brian@acme.dev', accountId: 'acct-acme', plan: 'pro' } as const

/** Saves light and dark captures when SEAL_ACCOUNTS_SHOT_DIR names a folder. */
async function capture(page: Page, name: string, section?: Locator): Promise<void> {
  const dir = process.env.SEAL_ACCOUNTS_SHOT_DIR
  if (!dir) {
    return
  }
  mkdirSync(dir, { recursive: true })
  // Scrolls only the settings list, leaving room for the section's heading above it.
  await section?.evaluate((element) => {
    let scroller = element.parentElement
    while (
      scroller &&
      !(
        scroller.scrollHeight > scroller.clientHeight &&
        /auto|scroll/.test(getComputedStyle(scroller).overflowY)
      )
    ) {
      scroller = scroller.parentElement
    }
    if (scroller) {
      scroller.scrollTop +=
        element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 96
    }
  })
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((next) => window.__store?.getState().updateSettings({ theme: next }), theme)
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
    // A dialog that is still fading in would be captured half drawn; spinners never finish.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map((animation) => animation.finished.catch(() => null))
      )
    )
    await page.screenshot({ path: path.join(dir, `${name}.${theme}.png`) })
  }
}

async function openAccounts(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    const state = window.__store?.getState()
    state?.openSettingsTarget({ pane: 'accounts', repoId: null })
    state?.openSettingsPage()
  })
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
}

function homeDir(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
}

function group(page: Page, provider: 'claude' | 'codex' | 'apiKeys'): Locator {
  return page.locator(`#seal-accounts-${provider}`)
}

function card(page: Page, provider: 'claude' | 'codex' | 'apiKeys', label: string): Locator {
  return group(page, provider).locator('[data-slot="seal-account-card"]').filter({ hasText: label })
}

async function expectNoFakeCliRunning(): Promise<void> {
  await expect
    .poll(() => clis.processes().filter((entry) => isProcessAlive(entry.pid)), { timeout: 15_000 })
    .toEqual([])
}

async function startClaudeSignIn(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Sign in with your browser/ }).click()
  await expect(dialog.getByText(FAKE_CLAUDE_SIGN_IN_LINK)).toBeVisible()
  return dialog
}

async function addClaudeAccount(page: Page, login: FakeClaudeLogin): Promise<void> {
  // The first-run page offers the same dialog from its own button.
  await page
    .locator('[data-slot="seal-add-claude"]')
    .or(page.getByRole('button', { name: 'Add Claude account' }))
    .first()
    .click()
  const dialog = await startClaudeSignIn(page)
  clis.nextClaudeLogin(login)
  await dialog.getByRole('textbox').fill(login.code)
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog.getByText(`Added ${login.email}.`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(card(page, 'claude', login.email)).toBeVisible()
}

test('first run: add a Claude account by pasted code and a Codex account by device code', async ({
  electronApp,
  orcaPage
}) => {
  await serveFakeAccountUsage(electronApp, {
    [fakeClaudeAccessToken(WORK.email)]: { session: 42, weekly: 18 },
    [fakeCodexAccessToken(CODEX.email)]: { session: 12, weekly: 55, plan: 'pro' }
  })
  await openAccounts(orcaPage)
  await expect(orcaPage.getByText('Add your first account')).toBeVisible()
  await capture(orcaPage, '01-no-accounts')

  await orcaPage.getByRole('button', { name: 'Add Claude account' }).click()
  await capture(orcaPage, '02-add-claude-methods')
  const dialog = await startClaudeSignIn(orcaPage)
  await capture(orcaPage, '03-add-claude-paste-code')
  clis.nextClaudeLogin(WORK)
  await dialog.getByRole('textbox').fill(WORK.code)
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(dialog.getByText(`Added ${WORK.email}.`)).toBeVisible()
  await capture(orcaPage, '04-add-claude-done')
  await dialog.getByRole('button', { name: 'Done' }).click()

  await orcaPage.locator('[data-slot="seal-add-codex"]').click()
  await capture(orcaPage, '05-add-codex-methods')
  await dialog.getByRole('button', { name: /Sign in with a device code/ }).click()
  await expect(dialog.getByText(FAKE_CODEX_DEVICE_CODE)).toBeVisible()
  await capture(orcaPage, '06-add-codex-device-code')
  clis.approveCodexLogin(CODEX)
  await expect(dialog.getByText(`Added ${CODEX.email}.`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()

  const claude = card(orcaPage, 'claude', WORK.email)
  await expect(claude).toContainText('Acme')
  // A healthy login carries no status at all.
  await expect(claude.locator('[data-slot="seal-account-health"]')).toHaveCount(0)
  await expect(claude).toContainText('42%')
  await expect(claude).toContainText('18%')
  const codex = card(orcaPage, 'codex', CODEX.email)
  await expect(codex).toContainText('12%')
  await expect(codex).toContainText('55%')
  await expect(orcaPage.getByText('2 accounts on this computer.')).toBeVisible()
  await expectNoFakeCliRunning()
  await capture(orcaPage, '07-accounts-after-first-run')
})

test('a cancelled, rejected or abandoned sign-in adds nothing and leaves no CLI running', async ({
  orcaPage
}) => {
  await openAccounts(orcaPage)

  await orcaPage.getByRole('button', { name: 'Add Claude account' }).click()
  let dialog = await startClaudeSignIn(orcaPage)
  await dialog.getByRole('button', { name: 'Cancel sign-in' }).click()
  await expect(dialog.getByText('Sign-in cancelled. Nothing was added.')).toBeVisible()
  await expectNoFakeCliRunning()

  await dialog.getByRole('button', { name: 'Try again' }).click()
  await expect(dialog.getByText(FAKE_CLAUDE_SIGN_IN_LINK)).toBeVisible()
  clis.nextClaudeLogin(WORK)
  await dialog.getByRole('textbox').fill('not-the-code')
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(
    dialog.getByText('Claude did not accept that code. Start the sign-in again.')
  ).toBeVisible()
  await capture(orcaPage, '08-sign-in-rejected-code')
  await expectNoFakeCliRunning()
  await orcaPage.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // Closing the dialog mid sign-in is a cancel too.
  await orcaPage.getByRole('button', { name: 'Add Codex account' }).click()
  dialog = orcaPage.getByRole('dialog')
  await dialog.getByRole('button', { name: /Sign in with your browser/ }).click()
  await expect(dialog.getByText('https://auth.openai.com/oauth/authorize')).toBeVisible()
  await capture(orcaPage, '09-add-codex-browser')
  await orcaPage.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expectNoFakeCliRunning()

  await expect(orcaPage.getByText('Add your first account')).toBeVisible()
  expect(clis.processes().filter((entry) => entry.args.includes('login')).length).toBeGreaterThan(0)
})

test("this computer's own CLI logins are ordinary accounts that stay removed", async ({
  electronApp,
  orcaPage
}) => {
  const home = await homeDir(electronApp)
  writeFakeClaudeSystemLogin(home, WORK)
  writeFakeCodexSystemLogin(home, CODEX)
  await serveFakeAccountUsage(electronApp, {
    [fakeClaudeAccessToken(WORK.email)]: { session: 30, weekly: 61 },
    [fakeCodexAccessToken(CODEX.email)]: { session: 5, weekly: 9, plan: 'pro' }
  })
  await openAccounts(orcaPage)

  const claude = card(orcaPage, 'claude', WORK.email)
  const codex = card(orcaPage, 'codex', CODEX.email)
  await expect(claude).toContainText('System login')
  await expect(codex).toContainText('System login')
  await capture(orcaPage, '10-system-logins-listed')

  await claude.getByRole('button', { name: `Actions for ${WORK.email}` }).click()
  await orcaPage.getByRole('menuitem', { name: 'Remove…' }).click()
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Remove and log out' })).toBeVisible()
  await capture(orcaPage, '11-remove-system-login')
  await dialog.getByRole('button', { name: 'Remove from Seal' }).click()
  await expect(claude).toHaveCount(0)
  // The machine's own login is untouched, and Seal still does not list it after a rescan.
  expect(existsSync(path.join(home, '.claude', '.credentials.json'))).toBe(true)
  await orcaPage.getByRole('button', { name: 'Refresh usage' }).first().click()
  await orcaPage.reload()
  await openAccounts(orcaPage)
  await expect(codex).toBeVisible()
  await expect(claude).toHaveCount(0)
  await capture(orcaPage, '12-system-login-removed')

  await codex.getByRole('button', { name: `Actions for ${CODEX.email}` }).click()
  await orcaPage.getByRole('menuitem', { name: 'Remove…' }).click()
  await dialog.getByRole('button', { name: 'Remove and log out' }).click()
  await expect(codex).toHaveCount(0)
  await expect.poll(() => existsSync(path.join(home, '.codex', 'auth.json'))).toBe(false)
  await expectNoFakeCliRunning()

  // Only an explicit import brings the removed login back.
  await orcaPage.getByRole('button', { name: `Use Claude login ${WORK.email}` }).click()
  await expect(claude).toContainText('System login')
  await capture(orcaPage, '13-system-login-imported-again')
})

test('several accounts: health, priority, rules, auto-swap and swap history', async ({
  electronApp,
  orcaPage
}) => {
  // A CI machine has no OS keychain; Electron's in-memory key stands in so API keys can be sealed.
  await electronApp.evaluate(({ safeStorage }) => {
    if (process.platform === 'linux') {
      safeStorage.setUsePlainTextEncryption(true)
    }
  })
  const usage = {
    [fakeClaudeAccessToken(WORK.email)]: { session: 93, weekly: 40 },
    [fakeClaudeAccessToken(PERSONAL.email)]: { session: 21, weekly: 12 },
    [fakeCodexAccessToken(CODEX.email)]: { session: 12, weekly: 55, plan: 'pro' }
  } as const
  await serveFakeAccountUsage(electronApp, usage)
  writeFakeCodexSystemLogin(await homeDir(electronApp), CODEX)
  await openAccounts(orcaPage)
  await addClaudeAccount(orcaPage, WORK)
  await addClaudeAccount(orcaPage, PERSONAL)

  await orcaPage.locator('[data-slot="seal-add-apiKeys"]').click()
  const dialog = orcaPage.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Team key')
  await dialog.getByLabel('Key', { exact: true }).fill('sk-ant-api03-seal-e2e')
  await capture(orcaPage, '14-add-api-key')
  await dialog.getByRole('button', { name: 'Add key' }).click()
  await expect(card(orcaPage, 'apiKeys', 'Team key')).toContainText('Anthropic API key')

  const personal = card(orcaPage, 'claude', PERSONAL.email)
  await personal.getByRole('button', { name: `Actions for ${PERSONAL.email}` }).click()
  await orcaPage.getByRole('menuitem', { name: 'Rename and limits…' }).click()
  await dialog.getByLabel('Name').fill('Side projects')
  await capture(orcaPage, '15-rename-and-limits')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(personal).toContainText('Side projects')

  const work = card(orcaPage, 'claude', WORK.email)
  const useWork = work.getByRole('button', { name: 'Use for new sessions' })
  if (await useWork.isVisible()) {
    await useWork.click()
  }
  await expect(work).toContainText('New sessions start here')
  await expect(work).toContainText('93%')
  await orcaPage.setViewportSize({ width: 1440, height: 2400 })
  await capture(orcaPage, '16-accounts-overview')
  await orcaPage.setViewportSize({ width: 1440, height: 1000 })

  // Keyboard reorder: the handle moves Side projects above the work account.
  const cards = group(orcaPage, 'claude').locator('[data-slot="seal-account-card"]')
  await expect(cards.first()).toContainText(WORK.email)
  const handle = orcaPage.getByRole('button', { name: 'Change the priority of Side projects' })
  await handle.focus()
  await orcaPage.keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  // A first arrow key can be spent scrolling the page, so press until the list announces the move.
  await expect(async () => {
    await orcaPage.keyboard.press('ArrowUp')
    await expect(orcaPage.getByRole('status').filter({ hasText: WORK.email })).toContainText(
      'was moved over droppable area',
      { timeout: 1_000 }
    )
  }).toPass()
  await orcaPage.keyboard.press('Space')
  await expect(cards.first()).toContainText('Side projects')

  await orcaPage.getByRole('button', { name: 'Add rule' }).click()
  await dialog.getByLabel('Repo or folder').fill('github.com/acme/*')
  await dialog.getByRole('checkbox', { name: new RegExp(WORK.email) }).check()
  await capture(orcaPage, '17-add-rule')
  await dialog.getByRole('button', { name: 'Save' }).click()
  const rules = orcaPage.locator('#seal-accounts-rules')
  await expect(rules).toContainText('github.com/acme/*')
  await expect(rules).toContainText(`May use ${WORK.email}.`)
  await capture(orcaPage, '18-rules', rules)

  const autoSwap = orcaPage.locator('#seal-accounts-auto-swap')
  await autoSwap.getByRole('switch', { name: 'Auto-swap new sessions' }).click()
  await autoSwap.getByRole('button', { name: 'Check now' }).click()
  await expect(personal).toContainText('New sessions start here')
  await capture(orcaPage, '19-auto-swap', autoSwap)
  const history = orcaPage.locator('#seal-accounts-history')
  await expect(history.locator('[data-slot="seal-swap-row"]').first()).toContainText(
    'Side projects'
  )
  await capture(orcaPage, '20-swap-history', history)

  // A login the provider stopped accepting is flagged and fixed in place.
  await serveFakeAccountUsage(electronApp, {
    ...usage,
    [fakeClaudeAccessToken(WORK.email)]: 'rejected'
  })
  // Seal reads an account at most every 30 seconds, however often Refresh usage is clicked.
  await expect(async () => {
    await orcaPage.getByRole('button', { name: 'Refresh usage' }).first().click()
    await expect(work).toContainText('Login rejected', { timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await capture(orcaPage, '21-login-rejected', group(orcaPage, 'claude'))
  await serveFakeAccountUsage(electronApp, {
    ...usage,
    [fakeClaudeAccessToken(WORK.email)]: { session: 3, weekly: 41 }
  })
  await work.getByRole('button', { name: 'Sign in again' }).click()
  await startClaudeSignIn(orcaPage)
  clis.nextClaudeLogin(WORK)
  await dialog.getByRole('textbox').fill(WORK.code)
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await expect(
    dialog.getByText(`${WORK.email} is signed in again.`, { exact: false })
  ).toBeVisible()
  await capture(orcaPage, '22-signed-in-again')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(work.locator('[data-slot="seal-account-health"]')).toHaveCount(0)
  await expect(work).toContainText('3%')
  await expectNoFakeCliRunning()
})

test('a paired machine shows on each card, takes a pushed login and the synced rules', async ({
  electronApp,
  orcaPage
}) => {
  const usage = { [fakeClaudeAccessToken(WORK.email)]: { session: 34, weekly: 22 } }
  const host = await launchHeadlessPairedRuntimeHost({ extraEnv: clis.env })
  try {
    await serveFakeAccountUsage(electronApp, usage)
    await serveFakeAccountUsage(host.app, usage)
    // Paired first, as from the Machines page: the accounts page reads the machine list when it opens.
    await orcaPage.evaluate(async (pairingCode) => {
      const store = window.__store
      await window.api.runtimeEnvironments.addFromPairingCode({ name: 'build-box', pairingCode })
      const environments = await window.api.runtimeEnvironments.list()
      store?.getState().setRuntimeEnvironments(environments)
      await Promise.all(
        environments.map((entry) => store?.getState().refreshRuntimeEnvironmentStatus(entry.id))
      )
    }, host.offer.pairingUrl)
    await openAccounts(orcaPage)
    await addClaudeAccount(orcaPage, WORK)
    await expect(orcaPage.getByText('1 account across 2 machines.', { exact: false })).toBeVisible()

    const work = card(orcaPage, 'claude', WORK.email)
    const machines = work.locator('[data-slot="seal-account-machines"]')
    await expect(machines).not.toContainText('build-box')
    await work.getByRole('button', { name: `Actions for ${WORK.email}` }).click()
    await orcaPage.getByRole('menuitem', { name: 'Push to machine' }).click()
    await capture(orcaPage, '23-push-to-machine')
    await orcaPage.getByRole('menuitem', { name: /build-box/ }).click()
    await expect(machines).toContainText('build-box')
    await capture(orcaPage, '24-account-on-two-machines')

    await orcaPage.getByRole('button', { name: 'Add rule' }).click()
    const dialog = orcaPage.getByRole('dialog')
    await dialog.getByLabel('Repo or folder').fill('github.com/acme/*')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await orcaPage.getByRole('button', { name: 'Add rule' }).click()
    await dialog.getByRole('radio', { name: 'Machine' }).click()
    await dialog.getByRole('combobox', { name: 'Machine' }).click()
    await orcaPage.getByRole('option', { name: 'build-box' }).click()
    await capture(orcaPage, '24b-rule-for-machine')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(orcaPage.locator('#seal-accounts-rules')).toContainText('build-box')
    await orcaPage.getByRole('button', { name: 'Sync to machines' }).click()
    await expect(
      orcaPage.getByText('Rules and auto-swap settings pushed to build-box.')
    ).toBeVisible()

    await work.getByRole('button', { name: `Actions for ${WORK.email}` }).click()
    await orcaPage.getByRole('menuitem', { name: 'Remove…' }).click()
    await expect(dialog.getByRole('checkbox', { name: /build-box/ })).toBeVisible()
    await capture(orcaPage, '25-remove-from-machines')
    await dialog.getByRole('checkbox', { name: /build-box/ }).check()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(work).toHaveCount(0)
    await expect(orcaPage.getByText('Add your first account')).toBeVisible()
    await expectNoFakeCliRunning()
  } finally {
    await host.dispose()
  }
})

test('Home lists the accounts with their usage, and Manage opens Settings > Accounts', async ({
  electronApp,
  orcaPage
}) => {
  await serveFakeAccountUsage(electronApp, {
    [fakeClaudeAccessToken(WORK.email)]: { session: 64, weekly: 31 },
    [fakeClaudeAccessToken(PERSONAL.email)]: { session: 8, weekly: 77 }
  })
  await openAccounts(orcaPage)
  await addClaudeAccount(orcaPage, WORK)
  await addClaudeAccount(orcaPage, PERSONAL)
  await orcaPage.getByRole('button', { name: 'Back to app' }).click()
  await orcaPage.evaluate(() => window.__store?.getState().setActiveView('home'))

  const accounts = orcaPage
    .locator('section')
    .filter({ has: orcaPage.getByRole('heading', { name: 'Accounts', exact: true }) })
  await expect(accounts).toContainText(WORK.email)
  await expect(accounts).toContainText(PERSONAL.email)
  await expect(accounts).toContainText('64%')
  await expect(accounts).toContainText('77%')
  await accounts.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await capture(orcaPage, '26-home-accounts-card')

  await accounts.getByRole('button', { name: 'Manage' }).click()
  await expect(orcaPage.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
  await expect(card(orcaPage, 'claude', PERSONAL.email)).toContainText('77%')
  await expectNoFakeCliRunning()
})

function claudeLogin(name: string): FakeClaudeLogin {
  return {
    email: `${name}@acme.dev`,
    organizationUuid: `org-${name}`,
    organizationName: 'Acme',
    code: `${name}-code#SEAL_E2E`
  }
}

/** The spoken form of each usage bar in a row, e.g. "5h: 34% used, resets in 2h 9m". */
function usageBars(row: Locator): Promise<(string | null)[]> {
  return row
    .getByRole('img')
    .evaluateAll((bars) => bars.map((bar) => bar.getAttribute('aria-label')))
}

test('account cards show the usage popover’s own figures, and only a full account is rate limited', async ({
  electronApp,
  orcaPage
}) => {
  const [roomy, near, full, throttled] = ['roomy', 'near', 'full', 'throttled'].map(claudeLogin)
  const now = Date.now()
  const usage = {
    [fakeClaudeAccessToken(roomy.email)]: claudeUsageWithRoom(now),
    [fakeClaudeAccessToken(near.email)]: claudeUsageNearLimit(now),
    [fakeClaudeAccessToken(full.email)]: claudeUsageAtLimit(now),
    [fakeClaudeAccessToken(throttled.email)]: claudeUsageCheckThrottled(600)
  }
  await serveFakeAccountUsage(electronApp, usage)
  await openAccounts(orcaPage)
  for (const login of [roomy, near, full, throttled]) {
    await addClaudeAccount(orcaPage, login)
  }
  const health = (login: FakeClaudeLogin): Locator =>
    card(orcaPage, 'claude', login.email).locator('[data-slot="seal-account-health"]')
  const cardUsage = (login: FakeClaudeLogin): Locator =>
    card(orcaPage, 'claude', login.email).locator('[data-slot="seal-account-usage"]')

  await expect(cardUsage(roomy)).toContainText('34%')
  await expect(cardUsage(roomy)).toContainText('61%')
  await expect(cardUsage(near)).toContainText('93%')
  await expect(cardUsage(near)).toContainText('78%')
  await expect(cardUsage(full)).toContainText('100%')
  await expect(cardUsage(full)).toContainText('88%')
  // The usage endpoint refused the check itself; that is not the account running out.
  await expect(cardUsage(throttled)).toHaveText('Usage check throttled')

  await expect(health(full)).toHaveAttribute('data-health', 'rate-limited')
  await expect(health(full)).toContainText('Rate limited')
  for (const login of [roomy, near, throttled]) {
    await expect(health(login)).toHaveCount(0)
  }

  // The status bar's usage popover, opened over the page it has to agree with.
  await orcaPage.setViewportSize({ width: 1440, height: 1800 })
  await orcaPage.getByRole('button', { name: 'Usage', exact: true }).click()
  await orcaPage.getByRole('menuitem').filter({ hasText: 'Claude' }).first().click()
  const popoverRow = (login: FakeClaudeLogin): Locator =>
    orcaPage.getByRole('menuitem').filter({ hasText: login.email })
  // Whichever account new sessions start on is the popover's headline panel, not a row.
  const listed = [near, full, throttled]
  for (const login of listed) {
    await expect(popoverRow(login)).toBeVisible()
  }
  // Both are read in one pass so a countdown tick cannot fall between them.
  await expect(async () => {
    for (const login of listed) {
      const [onCard, inPopover] = await Promise.all([
        usageBars(cardUsage(login)),
        usageBars(popoverRow(login))
      ])
      expect(onCard).toEqual(inPopover)
    }
  }).toPass({ timeout: 10_000 })
  expect(await usageBars(cardUsage(near))).toHaveLength(2)
  await expect(popoverRow(throttled)).toContainText('Usage check throttled')
  const headline = orcaPage.getByRole('menu').filter({ hasText: 'Manage Accounts' }).last()
  await expect(headline).toContainText('34% used')
  await expect(headline).toContainText('61% used')
  await capture(orcaPage, '27-accounts-beside-usage-popover')
  await orcaPage.keyboard.press('Escape')
  await expect(popoverRow(near)).toHaveCount(0)
  await openAccounts(orcaPage)

  // `seal account usage` prints the same readings and the same verdicts.
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const cli = await runProcess({
    program: process.execPath,
    args: [
      path.join(process.cwd(), 'out', 'cli', 'index.js'),
      'account',
      'usage',
      '--agent',
      'claude'
    ],
    env: { ...process.env, ORCA_USER_DATA_PATH: userDataDir },
    timeoutMs: 60_000
  })
  expect(cli.code, `${cli.stderr}\n${cli.stdout}`).toBe(0)
  const cliRow = (login: FakeClaudeLogin): string =>
    cli.stdout.split('\n').find((line) => line.includes(login.email)) ?? ''
  expect(cliRow(roomy)).toMatch(/\sok\s+34% \(\S.*?\)\s+61% \(/)
  expect(cliRow(near)).toMatch(/\sok\s+93% \(\S.*?\)\s+78% \(/)
  expect(cliRow(full)).toMatch(/\srate limited \(\S.*?\)\s+100% \(\S.*?\)\s+88% \(/)
  expect(cliRow(throttled)).toMatch(/\sok\s+—\s+—\s/)
  expect(cliRow(throttled)).toContain('usage check throttled')
  if (process.env.SEAL_ACCOUNTS_SHOT_DIR) {
    writeFileSync(
      path.join(process.env.SEAL_ACCOUNTS_SHOT_DIR, '27-seal-account-usage.txt'),
      cli.stdout
    )
  }

  // A throttled check keeps the last reading and still does not mark the account rate limited.
  await serveFakeAccountUsage(electronApp, {
    ...usage,
    [fakeClaudeAccessToken(near.email)]: claudeUsageCheckThrottled(600)
  })
  const nearReading = (): Promise<string | undefined> =>
    orcaPage.evaluate(
      () =>
        window.__store
          ?.getState()
          .rateLimits.inactiveClaudeAccounts.find(
            (entry) => entry.rateLimits?.session?.usedPercent === 93
          )?.rateLimits?.usageMetadata?.failureKind
    )
  // Seal reads an account at most every 30 seconds, however often Refresh usage is clicked.
  await expect(async () => {
    await orcaPage.getByRole('button', { name: 'Refresh usage' }).first().click()
    await expect.poll(nearReading, { timeout: 2_000 }).toBe('rate-limited')
  }).toPass({ timeout: 60_000 })
  await expect(cardUsage(near)).toContainText('93%')
  await expect(health(near)).toHaveCount(0)
  await capture(orcaPage, '28-throttled-check-keeps-last-reading', group(orcaPage, 'claude'))
  await expectNoFakeCliRunning()
})
