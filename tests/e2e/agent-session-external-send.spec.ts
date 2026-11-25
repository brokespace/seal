// T4.3: the tab of a session started outside Seal types what its composer sends into the session's tmux pane.

import type { Page } from '@stablyai/playwright-test'
import {
  clickSidebarSessionRow,
  externalAgentSessionPane,
  showSidebar
} from './helpers/agent-session-sidebar-open'
import { waitForLiveSession } from './helpers/live-session-registry'
import { expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  resolveTmuxOnPath,
  startTmuxPaneClaudeStub,
  test,
  type TmuxPaneClaudeStub
} from './helpers/tmux-pane-claude-stub'

const tmux = resolveTmuxOnPath()
const ENTER_IGNORED = 'The message is at the prompt, but Enter did not send it'

function turnsOf(agent: TmuxPaneClaudeStub): string[] {
  return agent.events().flatMap((entry) => (entry.event === 'turn' ? [entry.text] : []))
}

async function outboxStates(page: Page, sessionId: string): Promise<Record<string, string>> {
  const messages = await page.evaluate(
    (id) => window.api.liveSessions.messages({ sessionId: id }),
    sessionId
  )
  return Object.fromEntries(messages.map((message) => [message.text.trim(), message.state]))
}

test('a message with a file mention, a slash command and a retried failed send reach the tmux pane', async ({
  orcaPage: page,
  electronApp,
  tmuxSocketRoot
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  test.skip(tmux === null, 'tmux is not on PATH')
  // One scan to list the session, then three sends; the failed one takes Seal about 7 s to give up on.
  test.setTimeout(240_000)
  await showSidebar(page)
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  const cwd = await page.evaluate(
    (id) =>
      Object.values(window.__store!.getState().worktreesByRepo)
        .flat()
        .find((worktree) => worktree.id === id)!.path,
    worktreeId
  )
  const agent = await startTmuxPaneClaudeStub(electronApp, {
    tmux: tmux!,
    socketRoot: tmuxSocketRoot,
    cwd,
    title: 'Tmux session to type into'
  })
  await waitForLiveSession(
    page,
    agent.sessionId,
    (s) => s.status === 'your-turn' && s.inputRoutes.some((route) => route.kind === 'tmux'),
    { message: 'the registry never listed the tmux pane as a way to type into the session' }
  )

  await clickSidebarSessionRow(page, agent.sessionId)
  const pane = externalAgentSessionPane(page, agent.sessionId)
  const chat = pane.locator('[data-native-chat-root="true"]')
  const composer = chat.getByRole('textbox')
  const picker = page.locator('[role="listbox"][id^="native-chat-picker-"]')
  const pendingRows = chat.locator('[data-native-chat-message-id^="live-message:"]')
  await expect(pane).toContainText('Stub reply 1.', { timeout: 30_000 })

  await composer.click()
  await page.keyboard.type('review @index')
  await expect(picker.getByRole('option', { name: /index\.ts/ })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await page.keyboard.press('Enter')
  await expect(composer).toHaveText('review @src/index.ts ')
  await page.keyboard.press('Enter')
  await expect.poll(agent.screen, { timeout: 30_000 }).toContain('you: review @src/index.ts')
  await expect(pane).toContainText('Stub reply 2.', { timeout: 30_000 })
  await expect(pendingRows).toHaveCount(0, { timeout: 30_000 })
  await expect(chat).toContainText('index.ts')

  await composer.click()
  // No host runs commands for this session: the text goes to the agent, which reads it as its own command.
  await page.keyboard.type('/help')
  await expect(composer).toHaveText('/help')
  await page.keyboard.press('Enter')
  await expect.poll(agent.screen, { timeout: 30_000 }).toContain('you: /help')
  await expect(pane).toContainText('Stub reply 3.', { timeout: 30_000 })
  await expect(pendingRows).toHaveCount(0, { timeout: 30_000 })
  expect(await outboxStates(page, agent.sessionId)).toEqual({
    'review @src/index.ts': 'delivered',
    '/help': 'delivered'
  })

  agent.ignoreEnter(true)
  await composer.click()
  await page.keyboard.type('run the tests again')
  await page.keyboard.press('Enter')
  const failedRow = pendingRows.filter({ hasText: 'run the tests again' })
  await expect(failedRow).toContainText(ENTER_IGNORED, { timeout: 30_000 })
  const retry = failedRow.getByRole('button', { name: 'Send', exact: true })
  await expect(retry).toBeVisible()
  expect(turnsOf(agent)).not.toContain('run the tests again')

  agent.ignoreEnter(false)
  agent.clearPrompt()
  await expect.poll(agent.screen).not.toContain('run the tests again')
  await retry.click()
  await expect.poll(agent.screen, { timeout: 30_000 }).toContain('you: run the tests again')
  await expect(pane).toContainText('Stub reply 4.', { timeout: 30_000 })
  await expect(pendingRows).toHaveCount(0, { timeout: 30_000 })
  expect(turnsOf(agent).filter((text) => text === 'run the tests again')).toHaveLength(1)
})
