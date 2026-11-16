// Each session has one owner that announces it (chat lane, hook lane, registry notifier); a second announcement of one event is the bug.
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import type { LiveSession } from '../../src/shared/live-sessions/live-session-types'
import {
  captureDesktopNotifications,
  clickDesktopNotification,
  readDesktopNotifications
} from './helpers/desktop-notification-capture'
import { FINISHED_TURN_REPLY, seedExternalClaudeSession } from './helpers/external-claude-session'
import { rescanLiveSessions, waitForLiveSession } from './helpers/live-session-registry'
import {
  expect,
  readStubChatLiveSession,
  sendStubChatPrompt,
  startStubChat,
  SUPPORTED,
  test,
  useScriptedSessionServices,
  type StubChat
} from './helpers/session-services-stub'
import { startTerminalPaneClaudeSession } from './helpers/terminal-pane-claude-hooks'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'
const PROMPT = 'Fix the login redirect loop'
const CHAT_REPLY = 'Fixed the login redirect and added a test.'
const CHAT_ASKING_REPLY =
  'I looked at both options. Tell me which one you want and should I go ahead'
// The hook lane cuts a body at 180 characters.
const CLI_FINISHED_BODY =
  'I traced the loop to the session check running before the cookie was read, moved it after, and added a regression test. Details are in https://github.com/acme/app/pull/42 for revi…'
const QUESTION = 'Which fix do you want?'

/** "<repo> / <branch>": how the chat and hook lanes name the workspace a session runs in. */
function workspaceLabel(repoPath: string, worktreeId: string): string {
  const worktreePath = worktreeId.slice(worktreeId.indexOf('::') + 2)
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: worktreePath,
    encoding: 'utf8'
  }).trim()
  return `${path.basename(repoPath)} / ${branch}`
}

/**
 * Leaves for the terminal tab as soon as the next Enter is handled: a chat on screen is read, not
 * announced, and the stub's 500 ms turn is too short to switch tabs from the test process.
 */
async function leaveChatTabOnSend(page: Page, chat: StubChat): Promise<void> {
  await page.evaluate((worktreeId) => {
    const leave = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') {
        return
      }
      window.removeEventListener('keydown', leave, true)
      setTimeout(() => {
        const state = window.__store?.getState()
        const terminal = state?.unifiedTabsByWorktree[worktreeId]?.find(
          (tab) => tab.contentType === 'terminal'
        )
        if (terminal) {
          state?.activateTab(terminal.id, { worktreeId })
        }
      }, 0)
    }
    window.addEventListener('keydown', leave, true)
  }, chat.worktreeId)
}

/** The chat's registry session once it matches; its id is unknown until the stub's first turn. */
async function waitForChatLiveSession(
  page: Page,
  chat: StubChat,
  matches: (session: LiveSession) => boolean
): Promise<void> {
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(page)
        const session = await readStubChatLiveSession(page, chat)
        return session !== null && matches(session)
      },
      { timeout: 90_000, message: 'the chat did not reach the expected state in the registry' }
    )
    .toBe(true)
}

/** Two more scans republish every session; a second producer would announce one of them here. */
async function rescanTwice(page: Page): Promise<void> {
  await rescanLiveSessions(page)
  await rescanLiveSessions(page)
}

/** The only other tab of a two-tab workspace; a terminal's title follows its shell, so not by title. */
function otherTabThan(page: Page, tabId: string | null): Locator {
  return page.locator(`${SORTABLE_TAB}:not([data-tab-id="${tabId}"])`)
}

/** A background launch opens a session without showing or focusing the window. */
async function expectWindowStaysInBackground(app: ElectronApplication): Promise<void> {
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => [window.isVisible(), window.isFocused()])
    )
  ).toEqual([[false, false]])
}

test.describe('desktop notifications for agent sessions', () => {
  test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')

  test('a chat finishing its turn on a background tab raises one notification that opens its tab', async ({
    orcaPage,
    electronApp,
    sessionServicesStub,
    testRepoPath
  }, testInfo) => {
    // Runs a turn, then waits out its summary and two more registry scans for a second notification.
    test.setTimeout(240_000)
    await captureDesktopNotifications(electronApp)
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    const chat = await startStubChat(orcaPage, sessionServicesStub)
    const terminalTab = otherTabThan(orcaPage, await chat.tab.getAttribute('data-tab-id'))
    const finished = {
      title: `${workspaceLabel(testRepoPath, chat.worktreeId)} - Claude finished`,
      body: CHAT_REPLY
    }

    await leaveChatTabOnSend(orcaPage, chat)
    await sendStubChatPrompt(chat, PROMPT)
    await expect(terminalTab).toHaveAttribute('data-active', 'true')
    await expect
      .poll(() => readDesktopNotifications(electronApp), { timeout: 30_000 })
      .toEqual([finished])
    // The chat is also a registry session; its summary and recap republish it there.
    await waitForChatLiveSession(
      orcaPage,
      chat,
      (found) =>
        found.status === 'your-turn' && found.summary !== undefined && found.recap !== undefined
    )
    await rescanTwice(orcaPage)
    expect(await readDesktopNotifications(electronApp)).toEqual([finished])

    await expect(chat.tab).toHaveAttribute('data-active', 'false')
    await clickDesktopNotification(electronApp, 0)
    await expect(chat.tab).toHaveAttribute('data-active', 'true')
    await expect(terminalTab).toHaveAttribute('data-active', 'false')
    await expect(chat.root.getByText(CHAT_REPLY)).toBeVisible()
    await expectWindowStaysInBackground(electronApp)
    await orcaPage.screenshot({ path: testInfo.outputPath('chat-opened-from-notification.png') })
  })

  test('a CLI session finishing its turn in a background terminal tab raises one notification that opens its tab', async ({
    orcaPage,
    electronApp,
    sessionServicesStub,
    testRepoPath
  }, testInfo) => {
    // Runs a turn, then waits out its summary and two more registry scans for a second notification.
    test.setTimeout(240_000)
    await captureDesktopNotifications(electronApp)
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    const cli = await startTerminalPaneClaudeSession(electronApp, orcaPage)
    const cliTabId = cli.pane.paneKey.split(':')[0]
    const cliTab = orcaPage.locator(`${SORTABLE_TAB}[data-tab-id="${cliTabId}"]`)
    const otherTab = otherTabThan(orcaPage, cliTabId)
    const finished = {
      title: `${workspaceLabel(testRepoPath, cli.pane.worktreeId)} - Claude finished`,
      body: CLI_FINISHED_BODY
    }

    // Hidden animated terminals can fail Playwright's stability check on an enabled button.
    await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
    await orcaPage
      .getByRole('menuitem', { name: /New Terminal/i })
      .first()
      .click()
    await expect(otherTab).toHaveAttribute('data-active', 'true')
    await expect(cliTab).toHaveAttribute('data-active', 'false')

    await cli.submitPrompt(PROMPT)
    await waitForLiveSession(orcaPage, cli.sessionId, (found) => found.status === 'working')
    // Neither a session's first sighting nor its working state is announced.
    expect(await readDesktopNotifications(electronApp)).toEqual([])

    await cli.finishTurn(FINISHED_TURN_REPLY)
    await expect
      .poll(() => readDesktopNotifications(electronApp), { timeout: 30_000 })
      .toEqual([finished])
    // The pane is also a registry session, and its holding process an idle external one.
    await waitForLiveSession(
      orcaPage,
      cli.sessionId,
      (found) => found.status === 'your-turn' && found.summary !== undefined,
      { timeout: 90_000 }
    )
    await rescanTwice(orcaPage)
    expect(await readDesktopNotifications(electronApp)).toEqual([finished])

    await clickDesktopNotification(electronApp, 0)
    await expect(cliTab).toHaveAttribute('data-active', 'true')
    await expect(otherTab).toHaveAttribute('data-active', 'false')
    await expectWindowStaysInBackground(electronApp)
    await orcaPage.screenshot({ path: testInfo.outputPath('cli-opened-from-notification.png') })
  })

  test('an external session finishing its turn raises one notification that opens it', async ({
    orcaPage,
    electronApp,
    sessionServicesStub
  }, testInfo) => {
    // Runs a turn, then waits out its summary and two more registry scans for a second notification.
    test.setTimeout(240_000)
    await captureDesktopNotifications(electronApp)
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    const session = await seedExternalClaudeSession(electronApp)
    const finished = {
      title: PROMPT,
      body: `Claude Code on ${hostname()} finished: ${FINISHED_TURN_REPLY}`
    }
    try {
      session.submitPrompt(PROMPT)
      await waitForLiveSession(orcaPage, session.sessionId, (found) => found.status === 'working')
      expect(await readDesktopNotifications(electronApp)).toEqual([])

      session.finishTurn(FINISHED_TURN_REPLY)
      await expect
        .poll(() => readDesktopNotifications(electronApp), { timeout: 60_000 })
        .toEqual([finished])
      await waitForLiveSession(
        orcaPage,
        session.sessionId,
        (found) => found.summary !== undefined && found.recap !== undefined,
        { timeout: 90_000 }
      )
      await rescanTwice(orcaPage)
      expect(await readDesktopNotifications(electronApp)).toEqual([finished])

      const pane = orcaPage.locator(`[data-live-session-pane="${session.sessionId}"]`)
      await expect(pane).toHaveCount(0)
      await clickDesktopNotification(electronApp, 0)
      await expect(pane).toBeVisible()
      await expect(
        orcaPage.locator(`[data-live-session-tab="${session.sessionId}"]`)
      ).toHaveAttribute('aria-selected', 'true')
      await expect(pane).toContainText(PROMPT)
      await expectWindowStaysInBackground(electronApp)
      await orcaPage.screenshot({
        path: testInfo.outputPath('external-opened-from-notification.png')
      })
    } finally {
      session.stop()
    }
  })

  test('a session stopping to ask raises one notification on each surface', async ({
    orcaPage,
    electronApp,
    sessionServicesStub,
    testRepoPath
  }) => {
    // Runs a turn on all three surfaces and waits out the reply classifier and the registry scans for each.
    test.setTimeout(300_000)
    await captureDesktopNotifications(electronApp)
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    const cli = await startTerminalPaneClaudeSession(electronApp, orcaPage)
    const chat = await startStubChat(orcaPage, sessionServicesStub)
    const external = await seedExternalClaudeSession(electronApp)
    const workspace = workspaceLabel(testRepoPath, chat.worktreeId)
    const externalAsked = {
      title: PROMPT,
      body: `Claude Code on ${hostname()} needs you: ${QUESTION}`
    }
    const cliAsked = { title: `${workspace} - Claude needs input`, body: 'Using AskUserQuestion' }
    // A question in prose ends the turn like any other; only the registry reads it as asking.
    const chatAsked = { title: `${workspace} - Claude finished`, body: CHAT_ASKING_REPLY }
    try {
      external.submitPrompt(PROMPT)
      await waitForLiveSession(orcaPage, external.sessionId, (found) => found.status === 'working')
      external.askQuestion(QUESTION)
      await expect
        .poll(() => readDesktopNotifications(electronApp), { timeout: 60_000 })
        .toEqual([externalAsked])

      // The chat's tab is on screen, so the terminal pane asks from a background tab.
      await cli.submitPrompt(PROMPT)
      await waitForLiveSession(orcaPage, cli.sessionId, (found) => found.status === 'working')
      await cli.askQuestion(QUESTION)
      await expect
        .poll(() => readDesktopNotifications(electronApp), { timeout: 30_000 })
        .toEqual([externalAsked, cliAsked])

      await leaveChatTabOnSend(orcaPage, chat)
      await sendStubChatPrompt(chat, 'ask-me which fix to make')
      await expect
        .poll(() => readDesktopNotifications(electronApp), { timeout: 30_000 })
        .toEqual([externalAsked, cliAsked, chatAsked])

      await waitForLiveSession(
        orcaPage,
        external.sessionId,
        (found) => found.status === 'waiting-input' && found.recap !== undefined,
        { timeout: 90_000 }
      )
      await waitForLiveSession(orcaPage, cli.sessionId, (found) => found.status === 'waiting-input')
      // The reply-ask classifier turns the chat's finished turn into a question after the fact.
      await waitForChatLiveSession(
        orcaPage,
        chat,
        (found) =>
          found.status === 'waiting-input' &&
          found.summary !== undefined &&
          found.recap !== undefined
      )
      await rescanTwice(orcaPage)
      expect(await readDesktopNotifications(electronApp)).toEqual([
        externalAsked,
        cliAsked,
        chatAsked
      ])
    } finally {
      external.stop()
    }
  })
})
