// On an SSH machine without a Seal server the launcher keeps Chat visible as the offer to install that server.
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { startOrcadConvertHost } from './helpers/orcad-convert-host'
import { seedRelayEraProfile } from './helpers/orcad-upgrade-profile'
import { waitForSessionReady } from './helpers/store'

test.skip(process.env.ORCA_E2E_SSH_DOCKER !== '1', 'Needs Docker')
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')

const INSTALL_OFFER = 'Install Seal server to chat here'
const CLI_LAUNCH_MARKER = '/tmp/seal-e2e-claude-cli-launch'
const CLAUDE_STUB = `#!/bin/sh
pwd > ${CLI_LAUNCH_MARKER}
echo SEAL_E2E_CLAUDE_STUB_READY
exec sleep 600
`

type SshOnlyWorkspace = {
  page: Page
  machineId: string
  readRemoteFile: (remotePath: string) => string
  screenshot: (name: string) => Promise<void>
}

type LauncherSettings = {
  agentDefaultSurface: 'chat' | 'terminal'
  nativeChatProviders: { claude?: boolean; codex?: boolean }
}

const CHAT_DEFAULT: LauncherSettings = {
  agentDefaultSurface: 'chat',
  nativeChatProviders: { claude: true, codex: true }
}
// What a fresh profile has: the CLI is every agent's surface.
const CLI_DEFAULT: LauncherSettings = { agentDefaultSurface: 'terminal', nativeChatProviders: {} }

function sshOnlyWorkspaceTest(
  title: string,
  settings: LauncherSettings,
  body: (workspace: SshOnlyWorkspace) => Promise<void>
): void {
  test(
    title,
    async (
      // oxlint-disable-next-line no-empty-pattern -- Owns its app launch through a restart session.
      {},
      testInfo
    ) => {
      // Starting the Docker SSH host and launching the app twice takes over a minute on a cold runner.
      test.setTimeout(5 * 60_000)
      const host = startOrcadConvertHost('docker', testInfo)
      const session = createRestartSession(testInfo)
      let app: ElectronApplication | null = null
      try {
        const exec = host.exec
        if (!exec) {
          throw new Error('the Docker host runs commands as its SSH user')
        }
        exec(
          `echo ${Buffer.from(CLAUDE_STUB).toString('base64')} | base64 -d > /usr/local/bin/claude && chmod 755 /usr/local/bin/claude`
        )
        const first = await session.launch()
        app = first.app
        await waitForSessionReady(first.page)
        await session.close(app)
        app = null
        const seeded = seedRelayEraProfile(session.userDataDir, host.input, {
          repoPath: host.remoteRepoPath,
          folderPath: host.remoteFolderPath
        })
        const launched = await session.launch()
        app = launched.app
        const page = launched.page
        await waitForSessionReady(page)
        await openSshOnlyWorkspace(page, seeded.targetId, settings)
        await body({
          page,
          machineId: `machine:${seeded.targetId}`,
          readRemoteFile: (remotePath) => exec(`cat ${remotePath} 2>/dev/null || true`).trim(),
          screenshot: (name) => attachScreenshot(page, testInfo, name)
        })
      } finally {
        await session.dispose(app ?? undefined)
        host.cleanup()
      }
    }
  )
}

async function openSshOnlyWorkspace(
  page: Page,
  targetId: string,
  settings: LauncherSettings
): Promise<void> {
  const machine = await page.evaluate(async (id) => {
    const state = await window.api.ssh.connect({ targetId: id })
    const machines = (await window.api.machines?.list()) ?? []
    const found = machines.find((entry) => entry.recordId === id)
    return {
      status: state?.status ?? null,
      managedServer: state?.managedServer ?? null,
      connection: found?.connection ?? null,
      server: found?.server ?? null
    }
  }, targetId)
  expect(machine).toEqual({
    status: 'connected',
    managedServer: null,
    connection: 'ssh',
    server: null
  })
  await page.evaluate(
    (launcher) =>
      window.__store!.getState().updateSettings({ ...launcher, defaultTuiAgent: 'claude' }),
    settings
  )
  await page.getByText('orcad upgrade folder', { exact: true }).first().click()
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file, animations: 'disabled' })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

async function openClaudeRow(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.getByRole('button', { name: 'New tab' }).first().click({ force: true })
  const row = page.getByRole('menuitem', { name: 'Claude', exact: true })
  await expect(row).toBeVisible()
  return row
}

async function expectMachineOpenedWithoutTabs(page: Page, machineId: string): Promise<void> {
  await expect(page.locator('[data-machines-page]')).toBeVisible()
  await expect(page.locator(`[data-machine-detail="${machineId}"]`)).toBeVisible()
  await expect(page.locator('[data-testid="sortable-tab"]')).toHaveCount(0)
  await expect(page.locator('[data-native-chat-root="true"]')).toHaveCount(0)
}

sshOnlyWorkspaceTest(
  'the + menu on an SSH machine without a server offers the Seal server install and opens that machine',
  CHAT_DEFAULT,
  async ({ page, machineId, screenshot }) => {
    const row = await openClaudeRow(page)
    const offer = row.locator('[data-agent-surface-action="chat"][data-agent-chat-install-offer]')
    await expect(offer).toBeVisible()
    await expect(offer).toHaveAccessibleName(INSTALL_OFFER)
    await expect(offer).toBeEnabled()
    await expect(row.locator('[data-agent-launch-row-note]')).toHaveText(INSTALL_OFFER)
    await expect(row.locator('[data-agent-surface-action]')).toHaveText(['Chat', 'CLI'])
    // No terminal starts on that machine before the server is there, so the CLI names the same way out.
    const cli = row.locator('[data-agent-surface-action="terminal"]')
    await expect(cli).toHaveAttribute('aria-disabled', 'true')
    await expect(cli).toHaveAccessibleDescription('Install Seal server to use the CLI here')
    await expect(page.getByText('No chat over SSH')).toHaveCount(0)
    await screenshot('plus-menu-ssh-install-offer')

    await offer.click()

    await expectMachineOpenedWithoutTabs(page, machineId)
    await screenshot('machines-page-after-offer')
  }
)

sshOnlyWorkspaceTest(
  'a plain click on the Claude row offers the Seal server install when chat is the default surface',
  CHAT_DEFAULT,
  async ({ page, machineId, readRemoteFile }) => {
    const row = await openClaudeRow(page)

    await row.click({ position: { x: 40, y: 12 } })

    await expectMachineOpenedWithoutTabs(page, machineId)
    expect(readRemoteFile(CLI_LAUNCH_MARKER)).toBe('')
  }
)

sshOnlyWorkspaceTest(
  'the Claude row keeps the Seal server install offer when the CLI is the default surface',
  CLI_DEFAULT,
  async ({ page, machineId, screenshot }) => {
    const row = await openClaudeRow(page)
    const offer = row.locator('[data-agent-surface-action="chat"][data-agent-chat-install-offer]')
    await expect(offer).toBeVisible()
    await expect(offer).toHaveAccessibleName(INSTALL_OFFER)
    await screenshot('plus-menu-ssh-install-offer-cli-default')

    await offer.click()

    await expectMachineOpenedWithoutTabs(page, machineId)
  }
)
