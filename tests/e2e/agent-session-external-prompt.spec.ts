// T4.4: the tab of a session started outside Seal shows what the session asks, and answers it where it can.

import type { Locator, Page } from '@stablyai/playwright-test'
import {
  clickSidebarSessionRow,
  externalAgentSessionPane,
  showSidebar
} from './helpers/agent-session-sidebar-open'
import { readLiveSession, waitForLiveSession } from './helpers/live-session-registry'
import { expect } from './helpers/orca-app'
import {
  seedLiveSession,
  stopAllSeededSessions,
  waitForLiveSessions
} from './helpers/seeded-live-sessions'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  resolveTmuxOnPath,
  startTmuxPaneClaudeStub,
  test,
  TMUX_STUB_ASKS_PERMISSION,
  TMUX_STUB_ASKS_QUESTION,
  TMUX_STUB_PERMISSION,
  TMUX_STUB_QUESTION
} from './helpers/tmux-pane-claude-stub'

const tmux = resolveTmuxOnPath()
const PROMPT_CARD = '[data-native-chat-approval-card="true"]'

async function activeWorkspaceFolder(page: Page): Promise<string> {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  return page.evaluate(
    (id) =>
      Object.values(window.__store!.getState().worktreesByRepo)
        .flat()
        .find((worktree) => worktree.id === id)!.path,
    worktreeId
  )
}

function optionButtons(card: Locator, labels: readonly string[]): Locator[] {
  return labels.map((label) => card.getByRole('button', { name: label, exact: true }))
}

test.afterEach(async () => {
  await stopAllSeededSessions()
})

test('a permission prompt and a question of a session in tmux are answered from the card in its tab', async ({
  orcaPage: page,
  electronApp,
  tmuxSocketRoot
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  test.skip(tmux === null, 'tmux is not on PATH')
  // Each prompt is read off the pane by a scan, and so is its leaving.
  test.setTimeout(240_000)
  await showSidebar(page)
  const agent = await startTmuxPaneClaudeStub(electronApp, {
    tmux: tmux!,
    socketRoot: tmuxSocketRoot,
    cwd: await activeWorkspaceFolder(page),
    title: 'Tmux session that asks'
  })
  await waitForLiveSession(page, agent.sessionId, (s) => s.status === 'your-turn')
  const answers = (): string[] =>
    agent.events().flatMap((entry) => (entry.event === 'answered' ? [entry.option] : []))

  agent.submit(`touch a file ${TMUX_STUB_ASKS_PERMISSION}`)
  const asking = await waitForLiveSession(page, agent.sessionId, (s) => s.permission !== null)
  expect({
    status: asking.status,
    answer: asking.capabilities.answer,
    question: asking.permission?.question,
    options: asking.permission?.options.map((option) => option.label)
  }).toEqual({
    status: 'needs-permission',
    answer: 'options',
    question: TMUX_STUB_PERMISSION.question,
    options: TMUX_STUB_PERMISSION.options
  })

  await clickSidebarSessionRow(page, agent.sessionId)
  const pane = externalAgentSessionPane(page, agent.sessionId)
  const composer = pane.locator('[data-native-chat-root="true"]').getByRole('textbox')
  const permission = pane.getByRole('group', { name: TMUX_STUB_PERMISSION.question })
  await expect(permission).toBeVisible({ timeout: 30_000 })
  for (const option of optionButtons(permission, TMUX_STUB_PERMISSION.options)) {
    await expect(option).toBeVisible()
  }
  // The prompt stands where the composer was: its options are the only answer the session takes.
  await expect(composer).toHaveCount(0)
  await permission.getByRole('button', { name: 'No', exact: true }).click()
  await expect.poll(answers, { timeout: 30_000 }).toEqual(['No'])
  await expect(pane.locator(PROMPT_CARD)).toHaveCount(0, { timeout: 30_000 })
  await expect(composer).toBeVisible({ timeout: 30_000 })

  agent.submit(`format the file ${TMUX_STUB_ASKS_QUESTION}`)
  const question = pane.getByRole('group', { name: TMUX_STUB_QUESTION.question })
  await expect(question).toBeVisible({ timeout: 60_000 })
  for (const option of optionButtons(question, TMUX_STUB_QUESTION.options)) {
    await expect(option).toBeVisible()
  }
  await question.getByRole('button', { name: 'Spaces', exact: true }).click()
  await expect.poll(answers, { timeout: 30_000 }).toEqual(['No', 'Spaces'])
  await expect(pane.locator(PROMPT_CARD)).toHaveCount(0, { timeout: 30_000 })
  await expect(pane).toContainText('Stub reply 3.', { timeout: 30_000 })
})

test('a session that asks where Seal cannot type shows no answer buttons in its tab', async ({
  orcaPage: page,
  electronApp
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  test.setTimeout(180_000)
  await showSidebar(page)
  const cwd = await activeWorkspaceFolder(page)
  const asksPermission = await seedLiveSession(electronApp, {
    cwd,
    status: 'needs-permission',
    title: 'Asks for a permission'
  })
  const asksQuestion = await seedLiveSession(electronApp, {
    cwd,
    status: 'waiting-input',
    title: 'Asks a question'
  })
  await waitForLiveSessions(page, {
    [asksPermission.id]: 'needs-permission',
    [asksQuestion.id]: 'waiting-input'
  })

  for (const seeded of [asksPermission, asksQuestion]) {
    const session = await readLiveSession(page, seeded.id)
    // No pane to read the prompt off and none to key an answer into: the record says so.
    expect({
      permission: session?.permission ?? null,
      answer: session?.capabilities.answer,
      send: session?.capabilities.send
    }).toEqual({ permission: null, answer: 'none', send: false })

    await clickSidebarSessionRow(page, seeded.id)
    const pane = externalAgentSessionPane(page, seeded.id)
    await expect(pane).toBeVisible()
    await expect(pane.locator('[data-agent-session-header]')).toBeVisible()
    await expect(pane.locator(PROMPT_CARD)).toHaveCount(0)
    await expect(pane.locator('[data-native-chat-approval-actions="true"] button')).toHaveCount(0)
    // Nothing typed here goes out: the session has no route for it.
    await pane.locator('[data-native-chat-root="true"]').getByRole('textbox').click()
    await page.keyboard.type('yes')
    await page.keyboard.press('Enter')
    expect(
      await page.evaluate((id) => window.api.liveSessions.messages({ sessionId: id }), seeded.id)
    ).toEqual([])
  }
})
