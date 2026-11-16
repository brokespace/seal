import { realpathSync } from 'node:fs'
import path from 'node:path'
import { expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import {
  readClaudeStubLaunches,
  SUPPORTED,
  test,
  type ClaudeStubLaunch
} from './helpers/structured-claude-stub'
import { execInTerminal, waitForActivePanePtyId } from './helpers/terminal'

// Stands in for a shell that reports its folder (OSC 7); the seeded shell sends none.
const ENTER_SRC_AND_REPORT_FOLDER = String.raw`cd src && printf '\033]7;file://localhost%s\007' "$PWD"`
// The stub draws no TUI, so the pane is given the idle title (✳ Claude Code) the real CLI sets.
const RUN_CLAUDE_CLI = String.raw`printf '\033]0;\342\234\263 Claude Code\007'; claude`

/** The conversations the stub started; model-list probes speak stream-json too but name no session. */
function readChatLaunches(launchLog: string): ClaudeStubLaunch[] {
  return readClaudeStubLaunches(launchLog).filter(
    ({ args }) =>
      args.includes('stream-json') && args.some((arg) => arg.startsWith('--session-id='))
  )
}

test.describe('chat from a terminal in a workspace subfolder', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  test('hands a Claude terminal in src off to a chat that runs in src', async ({
    orcaPage: page,
    claudeStub,
    testRepoPath
  }, testInfo) => {
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await page.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        nativeChatProviders: { claude: true, codex: true },
        defaultTuiAgent: 'claude',
        agentCmdOverrides: { claude: command }
      })
    }, buildFakeAgentCommandOverride(claudeStub.command))
    const subfolder = path.join(testRepoPath, 'src')

    const ptyId = await waitForActivePanePtyId(page)
    await execInTerminal(page, ptyId, ENTER_SRC_AND_REPORT_FOLDER)
    await execInTerminal(page, ptyId, RUN_CLAUDE_CLI)

    await page.getByRole('button', { name: 'Hand Off to Another Agent' }).click()
    const dialog = page.getByRole('dialog', { name: 'Hand Off to Another Agent' })
    await expect(dialog.getByText(subfolder, { exact: true })).toBeVisible()

    const agentField = dialog.getByRole('button', { name: 'Select agent' })
    await agentField.click()
    const configureClaude = page.getByRole('button', { name: 'Configure Claude' })
    // Any reason a chat cannot start here would be a note on the agent's row.
    await expect(
      page.locator('[data-agent-launch-row]').filter({ has: configureClaude })
    ).toHaveText('Claude')
    await expect(page.getByText(/No chat in (a )?subfolders?/i)).toHaveCount(0)
    await configureClaude.click()
    const launchChat = page.getByRole('button', { name: 'Launch chat' })
    await expect(launchChat).toBeVisible()
    await testInfo.attach('continuation-dialog-subfolder', {
      // The setup panel is still fading in when its button first counts as visible.
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png'
    })
    await launchChat.click()
    await expect(agentField).toHaveText('Claude')
    await dialog.getByRole('button', { name: 'Start New Session' }).click()

    const chat = page.locator('[data-native-chat-root="true"]')
    await expect(chat).toBeVisible({ timeout: 30_000 })
    // The hand-off is staged as a draft naming the folder the terminal was in.
    await expect(chat.getByRole('textbox')).toContainText(subfolder)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.')).toBeVisible({ timeout: 30_000 })
    await testInfo.attach('subfolder-chat-tab', {
      body: await page.screenshot(),
      contentType: 'image/png'
    })

    const launches = readChatLaunches(claudeStub.launchLog)
    await testInfo.attach('subfolder-chat-launch', {
      body: JSON.stringify(launches),
      contentType: 'application/json'
    })
    expect(launches.map((launch) => launch.cwd)).toEqual([realpathSync(subfolder)])
  })
})
