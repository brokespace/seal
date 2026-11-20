import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_AGENTS,
  GOLDEN_STUB_READY_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import {
  getFirstWslDistro,
  removeWslGoldenStubAgent,
  stageWslGoldenStubAgent,
  useWslRuntimeForActiveProject
} from './helpers/wsl-golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  getTerminalContent,
  waitForTerminalOutput
} from './helpers/terminal'
import type { BuiltInWindowsTerminalShell } from '../../src/shared/windows-terminal-shell'

// Covers the Windows-only tab-bar launch path that the default-shell test misses.

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

const WINDOWS_SHELLS: readonly BuiltInWindowsTerminalShell[] = [
  'powershell.exe',
  'cmd.exe',
  'git-bash'
]

async function openWorkspaceTerminal(page: Page): Promise<void> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
}

for (const { id, menuItemName } of GOLDEN_STUB_AGENTS) {
  test(`tab-bar + menu launches ${id} into a live TUI @tab-bar-agent-launch-golden`, async ({
    orcaPage
  }) => {
    await openWorkspaceTerminal(orcaPage)
    await configureGoldenStubAgent(orcaPage, { agent: id })
    await launchGoldenStubAgentFromNewTab(orcaPage, menuItemName)

    const activeTab = orcaPage.locator('[data-testid="sortable-tab"][data-active="true"]')
    await expect(activeTab).toHaveAttribute('data-tab-title', /Golden Stub Agent|Codex|Claude/i)
    // The marker distinguishes an agent launch from an identical bare-shell tab.
    expect(await getTerminalContent(orcaPage)).toContain(GOLDEN_STUB_READY_MARKER)
  })
}

test('default settings: the Claude row offers Chat and CLI, and CLI runs the agent in a terminal tab @tab-bar-agent-launch-golden', async ({
  orcaPage
}, testInfo) => {
  await openWorkspaceTerminal(orcaPage)
  await configureGoldenStubAgent(orcaPage, { agent: 'claude' })
  const tabs = orcaPage.locator('[data-testid="sortable-tab"]')
  const tabIdsBeforeLaunch = await tabs.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-tab-id'))
  )

  await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  const claudeRow = orcaPage
    .locator('[data-agent-launch-row]')
    .and(orcaPage.getByRole('menuitem', { name: 'Claude', exact: true }))
  await expect(claudeRow).toBeVisible({ timeout: 15_000 })
  // Neither action may wait for a hover, so the pointer stays off the row.
  const chatAction = claudeRow.locator('[data-agent-surface-action="chat"]')
  const cliAction = claudeRow.locator('[data-agent-surface-action="terminal"]')
  await expect(chatAction).toBeVisible()
  await expect(chatAction).toHaveText('Chat')
  await expect(cliAction).toBeVisible()
  await expect(cliAction).toHaveText('CLI')
  await expect(claudeRow.locator('[data-agent-surface-action]')).toHaveText(['CLI', 'Chat'])
  const menuScreenshot = testInfo.outputPath('plus-menu-claude-chat-and-cli.png')
  // The menu fades in; an untimed capture can land on its transparent first frame.
  await orcaPage.screenshot({ path: menuScreenshot, animations: 'disabled' })
  await testInfo.attach('plus-menu-claude-chat-and-cli', {
    path: menuScreenshot,
    contentType: 'image/png'
  })

  await cliAction.click()
  await focusActiveTerminalInput(orcaPage)
  await waitForTerminalOutput(orcaPage, GOLDEN_STUB_READY_MARKER, 20_000)

  const activeTab = tabs.and(orcaPage.locator('[data-active="true"]'))
  await expect(activeTab).toHaveAttribute('data-tab-title', /Golden Stub Agent|Claude/i)
  expect(tabIdsBeforeLaunch).not.toContain(await activeTab.getAttribute('data-tab-id'))
  expect(await getTerminalContent(orcaPage)).toContain(GOLDEN_STUB_READY_MARKER)
  await expect(orcaPage.locator('[data-native-chat-root="true"]:visible')).toHaveCount(0)
  const terminalScreenshot = testInfo.outputPath('cli-tab-runs-stub-agent.png')
  await orcaPage.screenshot({ path: terminalScreenshot, animations: 'disabled' })
  await testInfo.attach('cli-tab-runs-stub-agent', {
    path: terminalScreenshot,
    contentType: 'image/png'
  })
})

// Suite-level skipping avoids launching Electron for each unsupported case.
test.describe('Windows runtimes', () => {
  test.skip(process.platform !== 'win32', 'Windows agent launch matrix is Windows-only')

  for (const shell of WINDOWS_SHELLS) {
    test(`tab-bar + menu launches an agent under ${shell} @tab-bar-agent-launch-golden`, async ({
      orcaPage
    }) => {
      await openWorkspaceTerminal(orcaPage)
      // Each shell family requires different launch-command quoting.
      await configureGoldenStubAgent(orcaPage, { agent: 'codex', windowsShell: shell })
      await launchGoldenStubAgentFromNewTab(orcaPage)

      expect(await getTerminalContent(orcaPage)).toContain(GOLDEN_STUB_READY_MARKER)
    })
  }

  test('tab-bar + menu launches an agent inside WSL @tab-bar-agent-launch-golden', async ({
    orcaPage
  }) => {
    await openWorkspaceTerminal(orcaPage)

    const distro = await getFirstWslDistro(orcaPage)
    test.skip(!distro, 'No WSL distro is available on this Windows host')
    const stage = stageWslGoldenStubAgent(distro!)
    test.skip(!stage, 'WSL distro would not accept the staged stub agent')

    try {
      // WSL must retarget both agent detection and the PTY.
      await useWslRuntimeForActiveProject(orcaPage, distro!)
      await configureGoldenStubAgent(orcaPage, { agent: 'codex' })
      await launchGoldenStubAgentFromNewTab(orcaPage)

      // The distro-only marker proves the agent ran in WSL.
      expect(await getTerminalContent(orcaPage)).toContain(GOLDEN_STUB_READY_MARKER)
    } finally {
      removeWslGoldenStubAgent(distro!, stage!)
    }
  })
})
