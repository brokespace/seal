// An agent's row in the New tab menu offers Chat and CLI, default surface first; the row starts the default.

import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { expectTerminalAccessibilityText } from './helpers/terminal'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import {
  readClaudeStubLaunches,
  SUPPORTED,
  test,
  type ClaudeStub
} from './helpers/structured-claude-stub'
import { claudeSessionIdForOrcaSession } from '../../src/main/claude/structured/claude-structured-session-id'

type Surface = 'chat' | 'terminal'

const TAB = '[data-testid="sortable-tab"]'
const CHAT_ROOT = '[data-native-chat-root="true"]'

/** Launches of the interactive CLI: not a version probe, a one-shot print, or a stream-json process. */
function readInteractiveCliLaunches(launchLog: string): string[][] {
  return readClaudeStubLaunches(launchLog)
    .map(({ args }) => args)
    .filter(
      (args) => !['--version', '-p', '--print', 'stream-json'].some((flag) => args.includes(flag))
    )
}

async function openWorkspace(page: Page, command: string, defaultSurface: Surface): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  // The workspace's first terminal lands before the launches, so it cannot pass for a launched tab.
  await ensureTerminalVisible(page)
  await page.evaluate(
    async ({ command, defaultSurface }) => {
      await window.__store?.getState().updateSettings({
        agentDefaultSurface: defaultSurface,
        // No per-agent choice: one would win over the default surface.
        nativeChatProviders: {},
        defaultTuiAgent: 'claude',
        agentCmdOverrides: { claude: command }
      })
    },
    { command: buildFakeAgentCommandOverride(command), defaultSurface }
  )
}

async function openClaudeRow(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'New tab', exact: true }).click({ force: true })
  const row = page.getByRole('menuitem', { name: 'Claude', exact: true })
  await expect(row).toBeVisible({ timeout: 15_000 })
  return row
}

/** Both actions show on a row the pointer is not over, in this order. */
async function expectSurfaceActions(
  row: Locator,
  surfaces: Surface[],
  labels: string[]
): Promise<void> {
  const actions = row.locator('[data-agent-surface-action]')
  await expect(actions).toHaveText(labels, { timeout: 15_000 })
  expect(await row.evaluate((element) => element.matches(':hover'))).toBe(false)
  for (const [index, surface] of surfaces.entries()) {
    const action = actions.nth(index)
    await expect(action).toHaveAttribute('data-agent-surface-action', surface)
    await expect(action).toBeVisible()
    // An action revealed on hover is in the layout but transparent, on itself or on a wrapper.
    await expect
      .poll(() =>
        action.evaluate((element) => {
          let opacity = 1
          for (
            let node: Element | null = element;
            node && !node.matches('[data-agent-launch-row]');
            node = node.parentElement
          ) {
            opacity *= Number(getComputedStyle(node).opacity)
          }
          return opacity
        })
      )
      .toBe(1)
  }
}

function surfaceAction(row: Locator, surface: Surface): Locator {
  return row.locator(`[data-agent-surface-action="${surface}"]`)
}

function readTabIds(page: Page): Promise<string[]> {
  return page
    .locator(TAB)
    .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id') ?? ''))
}

function readTab(page: Page, tabId: string) {
  return page.evaluate((id) => {
    const tab = Object.values(window.__store?.getState().unifiedTabsByWorktree ?? {})
      .flat()
      .find((candidate) => candidate.id === id)
    return tab ? { contentType: tab.contentType, entityId: tab.entityId } : null
  }, tabId)
}

/** The id of the active tab, once it is one that was not open before. */
async function waitForNewActiveTab(page: Page, knownTabIds: string[]): Promise<string> {
  const known = knownTabIds.map((id) => `:not([data-tab-id="${id}"])`).join('')
  const tab = page.locator(`${TAB}[data-active="true"]${known}`)
  await expect(tab).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(TAB)).toHaveCount(knownTabIds.length + 1)
  return (await tab.getAttribute('data-tab-id')) ?? ''
}

/** A new chat tab is showing; returns the app's id for its chat. */
async function expectNewChatTab(page: Page, knownTabIds: string[]): Promise<string> {
  const tabId = await waitForNewActiveTab(page, knownTabIds)
  await expect(page.locator(CHAT_ROOT)).toBeVisible({ timeout: 30_000 })
  const tab = await readTab(page, tabId)
  expect(tab).toMatchObject({ contentType: 'agent-session' })
  return tab!.entityId
}

/** A new terminal tab is showing and ran the Claude command, once, as an interactive CLI. */
async function expectNewCliTab(
  page: Page,
  knownTabIds: string[],
  claudeStub: ClaudeStub
): Promise<void> {
  const tabId = await waitForNewActiveTab(page, knownTabIds)
  await expect(page.locator(`[data-terminal-tab-id="${tabId}"] .xterm`)).toBeVisible()
  await expect(page.locator(CHAT_ROOT)).toBeHidden()
  expect(await readTab(page, tabId)).toMatchObject({ contentType: 'terminal' })
  await expectTerminalAccessibilityText(page, tabId, claudeStub.command)
  await expect
    .poll(() => readInteractiveCliLaunches(claudeStub.launchLog), { timeout: 30_000 })
    .toHaveLength(1)
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`)
  // A hidden window draws no frames, so the menu's fade-in would be caught at its transparent start.
  await page.screenshot({ path: file, animations: 'disabled' })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

test.describe('New tab menu agent surfaces', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  test('with chat as the default, Chat opens a chat and CLI opens a terminal', async ({
    orcaPage: page,
    claudeStub
  }, testInfo) => {
    await openWorkspace(page, claudeStub.command, 'chat')
    let row = await openClaudeRow(page)
    await expectSurfaceActions(row, ['chat', 'terminal'], ['Chat', 'CLI'])
    await attachScreenshot(page, testInfo, 'plus-menu-chat-default')

    let knownTabIds = await readTabIds(page)
    await surfaceAction(row, 'chat').click()
    const sessionId = claudeSessionIdForOrcaSession(await expectNewChatTab(page, knownTabIds))
    // The chat's own Claude process starts with its first message.
    const chat = page.locator(CHAT_ROOT)
    await chat.getByRole('textbox').click()
    await page.keyboard.type('hello')
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.')).toBeVisible({ timeout: 30_000 })
    const chatLaunches = readClaudeStubLaunches(claudeStub.launchLog)
      .map(({ args }) => args)
      .filter((args) => args.some((arg) => arg.includes(sessionId)))
    expect(chatLaunches).toHaveLength(1)
    expect(chatLaunches[0]).toContain('stream-json')
    expect(readInteractiveCliLaunches(claudeStub.launchLog)).toEqual([])
    await attachScreenshot(page, testInfo, 'chat-tab')

    row = await openClaudeRow(page)
    await expect(surfaceAction(row, 'terminal')).not.toHaveAttribute('aria-disabled', 'true')
    knownTabIds = await readTabIds(page)
    await surfaceAction(row, 'terminal').click()
    await expectNewCliTab(page, knownTabIds, claudeStub)
    await attachScreenshot(page, testInfo, 'cli-tab')
  })

  test('with chat as the default, a click on the row itself opens a chat', async ({
    orcaPage: page,
    claudeStub
  }) => {
    await openWorkspace(page, claudeStub.command, 'chat')
    const row = await openClaudeRow(page)
    await expectSurfaceActions(row, ['chat', 'terminal'], ['Chat', 'CLI'])
    const knownTabIds = await readTabIds(page)
    await row.getByText('Claude', { exact: true }).click()
    await expectNewChatTab(page, knownTabIds)
    expect(readInteractiveCliLaunches(claudeStub.launchLog)).toEqual([])
  })

  test('with CLI as the default, CLI comes first and the row itself opens a terminal', async ({
    orcaPage: page,
    claudeStub
  }, testInfo) => {
    await openWorkspace(page, claudeStub.command, 'terminal')
    const row = await openClaudeRow(page)
    await expectSurfaceActions(row, ['terminal', 'chat'], ['CLI', 'Chat'])
    await expect(surfaceAction(row, 'terminal')).not.toHaveAttribute('aria-disabled', 'true')
    await attachScreenshot(page, testInfo, 'plus-menu-cli-default')
    const knownTabIds = await readTabIds(page)
    await row.getByText('Claude', { exact: true }).click()
    await expectNewCliTab(page, knownTabIds, claudeStub)
  })
})
