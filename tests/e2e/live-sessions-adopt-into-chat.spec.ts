// Continuing a CLI session in Chat keeps its one record: the same id, the pin and the name the user gave it.

import type { Page, TestInfo } from '@stablyai/playwright-test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect } from './helpers/orca-app'
import { orcaCliResult } from './helpers/compiled-orca-cli'
import {
  configureDiscoverableStubAgentClis,
  launchDiscoverableStubAgentCli,
  writeDiscoverableStubAgentCli,
  type StubAgentCliLaunch
} from './helpers/discoverable-stub-agent-cli'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { SUPPORTED, test } from './helpers/structured-claude-stub'
import { sendToTerminal } from './helpers/terminal'
import type {
  LiveSession,
  LiveSessionRegistrySnapshot
} from '../../src/shared/live-sessions/live-session-types'

const CUSTOM_TITLE = 'Billing migration'

/** Every record that could be the conversation: its id, its folder, its pane, or a chat (the test opens one). */
function recordsOf(sessions: readonly LiveSession[], cli: StubAgentCliLaunch): LiveSession[] {
  return sessions.filter(
    (session) =>
      session.provider === 'claude' &&
      (session.providerSessionId === cli.sessionId ||
        session.cwd === cli.cwd ||
        session.surface.kind === 'chat' ||
        (session.surface.kind === 'cli' && session.surface.paneKey === cli.paneKey))
  )
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const dir = process.env.SEAL_LIVE_SESSIONS_SCREENSHOT_DIR
  const file = dir ? path.join(dir, `${name}.png`) : testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file, animations: 'disabled' })
}

test.describe('live sessions: a CLI session continued in Chat', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  test('stays one record with the same id, its pin and its name', async ({
    orcaPage: page,
    electronApp,
    claudeStub,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    // A CLI turn, the adoption and a chat turn, each read back through the CLI for up to 30 s.
    test.setTimeout(180_000)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const stubDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-stub-cli-'))
    registerPostElectronShutdownCleanup(async () =>
      rmSync(stubDir, { recursive: true, force: true })
    )
    const claudeCli = writeDiscoverableStubAgentCli(stubDir, 'claude')

    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await configureDiscoverableStubAgentClis(page, [claudeCli])
    const cli = await launchDiscoverableStubAgentCli(page, claudeCli)
    // A chat takes over a conversation from its transcript, which Claude writes from the first prompt.
    await sendToTerminal(page, cli.ptyId, 'plan the billing migration\r')
    await expect
      .poll(() => claudeCli.ledger().some((entry) => entry.event === 'finished'))
      .toBe(true)

    const id = `local:claude:${cli.sessionId}`
    /** Each listing that held the conversation more than once. */
    const listedTwice: string[][] = []
    const records = async (): Promise<LiveSession[]> => {
      const { sessions } = await orcaCliResult<LiveSessionRegistrySnapshot>(userDataDir, [
        'sessions',
        'list',
        '--all'
      ])
      const listed = recordsOf(sessions, cli)
      if (listed.length > 1) {
        listedTwice.push(listed.map((session) => session.id))
      }
      return listed
    }
    const expectListed = (expected: Partial<LiveSession>): Promise<void> =>
      expect.poll(records, { timeout: 30_000 }).toMatchObject([expected])

    const inPane: Partial<LiveSession> = {
      id,
      origin: 'seal',
      surface: { kind: 'cli', paneKey: cli.paneKey },
      inputRoutes: [{ kind: 'seal-pane', paneKey: cli.paneKey }]
    }
    // The scan has found the CLI's process and transcript too: one record from the pane and the scan.
    await expectListed({ ...inPane, pid: cli.pid, status: 'your-turn' })

    const activeAgents = page.getByTestId('active-agents')
    const row = activeAgents.locator(`[data-live-session-row="${id}"]`)
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to top' }).click()
    await expect(row.getByLabel('Pinned')).toBeVisible()
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename…' }).click()
    await page.getByRole('textbox', { name: 'Session name' }).fill(CUSTOM_TITLE)
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(row).toContainText(CUSTOM_TITLE)
    const annotated = { pinned: true, customTitle: CUSTOM_TITLE }
    await expectListed({ ...inPane, ...annotated })
    await shot(page, testInfo, 'adopt-before-cli-pane')

    // The pane's CLI and the chat's agent are two stubs of the one `claude` command.
    await page.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        nativeChatProviders: { claude: true },
        agentCmdOverrides: { claude: command }
      })
    }, buildFakeAgentCommandOverride(claudeStub.command))
    await page.getByRole('button', { name: 'Continue in Chat UI' }).click()

    const chat = page.locator('[data-native-chat-root="true"]')
    await expect(chat.getByText('REPLY plan the billing migration')).toBeVisible({
      timeout: 30_000
    })
    const chatTabId = await page
      .locator('[data-testid="sortable-tab"][data-active="true"]')
      .getAttribute('data-tab-id')
    const chatSessionId = chatTabId?.replace('structured-agent-session-', '') ?? ''
    expect(chatSessionId).toMatch(/^claude_/)
    const inChat: Partial<LiveSession> = {
      id,
      origin: 'seal',
      surface: { kind: 'chat', sessionId: chatSessionId, tabId: `${chatTabId}` },
      // A chat is reached through its host only: a route into the closed pane fails the match.
      inputRoutes: [{ kind: 'structured', sessionId: chatSessionId }],
      ...annotated
    }
    await expectListed(inChat)

    // The id must hold once the chat's own agent runs: it resumes the conversation, not a new one.
    await chat.getByRole('textbox').click()
    await page.keyboard.type('carry on')
    await page.keyboard.press('Enter')
    await expect(chat.getByText('Stub reply.')).toBeVisible({ timeout: 30_000 })
    expect(readFileSync(claudeStub.launchLog, 'utf8')).toContain(`--resume=${cli.sessionId}`)
    await expectListed({ ...inChat, alive: true, status: 'your-turn', lastMessage: 'Stub reply.' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(CUSTOM_TITLE)
    await expect(row.getByLabel('Pinned')).toBeVisible()
    await shot(page, testInfo, 'adopt-after-chat')

    expect(listedTwice).toEqual([])
  })
})
