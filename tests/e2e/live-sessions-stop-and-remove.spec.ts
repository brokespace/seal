// "Stop and remove" takes a running session off the list at once; its agent is stopped behind that.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { orcaCliResult } from './helpers/compiled-orca-cli'
import {
  configureDiscoverableStubAgentClis,
  launchDiscoverableStubAgentCli,
  STUB_CLI_IGNORES_SIGTERM,
  STUB_CLI_KEEPS_WORKING,
  writeDiscoverableStubAgentCli
} from './helpers/discoverable-stub-agent-cli'
import { getGoldenStubAgentLaunchEnv } from './helpers/golden-stub-agent'
import { stopAndRemoveFromRow } from './helpers/live-session-stop-and-remove'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  openStubChat,
  readClaudeStubLaunches,
  SUPPORTED,
  test as chatTest
} from './helpers/structured-claude-stub'
import { sendToTerminal } from './helpers/terminal'
import type { LiveSession } from '../../src/shared/live-sessions/live-session-types'

function runs(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function listed(userDataDir: string): Promise<LiveSession[]> {
  const { sessions } = await orcaCliResult<{ sessions: LiveSession[] }>(userDataDir, [
    'sessions',
    'list',
    '--all'
  ])
  return sessions
}

test.describe('a Claude CLI at work in a Seal pane', () => {
  // The fixture directory makes the tab bar list Claude; the launch runs the stub below.
  test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

  test('leaves the list within two seconds of "Stop and remove", then its process ends', async ({
    orcaPage,
    electronApp,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
    // A pane, an agent and the scan that pairs them come before the first check.
    test.setTimeout(180_000)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const stubDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-stub-cli-'))
    registerPostElectronShutdownCleanup(async () =>
      rmSync(stubDir, { recursive: true, force: true })
    )
    const cli = writeDiscoverableStubAgentCli(stubDir, 'claude')

    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await configureDiscoverableStubAgentClis(orcaPage, [cli])
    const claude = await launchDiscoverableStubAgentCli(orcaPage, cli)
    const id = `local:claude:${claude.sessionId}`
    // It outlives SIGTERM, so stopping it takes the whole five seconds Seal gives an agent to leave.
    const prompt = `long task ${STUB_CLI_KEEPS_WORKING} ${STUB_CLI_IGNORES_SIGTERM}`
    await sendToTerminal(orcaPage, claude.ptyId, `${prompt}\r`)
    const record = async () =>
      (await listed(userDataDir))
        .filter((session) => session.id === id)
        .map(({ status, alive, pid }) => ({ status, alive, pid }))
    // The scan has found its process: that is what a stop signals.
    await expect
      .poll(record, { timeout: 60_000 })
      .toEqual([{ status: 'working', alive: true, pid: claude.pid }])

    await orcaPage.locator('[data-live-sessions-badge="worktree"]').click()
    const row = orcaPage.getByTestId('active-agents').locator(`[data-live-session-row="${id}"]`)
    await expect(row).toHaveCount(1)
    await stopAndRemoveFromRow(orcaPage, row, testInfo)

    await expect.poll(() => runs(claude.pid), { timeout: 30_000 }).toBe(false)
    expect(cli.ledger().at(-1)).toEqual({ event: 'ignored-sigterm' })
    // Hidden for good: the scans after its process ended do not list it again.
    await orcaPage.evaluate(() => window.api.liveSessions.refresh())
    expect(await record()).toEqual([])
    await expect(row).toHaveCount(0)
  })
})

chatTest.describe('a chat at work', () => {
  chatTest.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  chatTest(
    'leaves the list within two seconds of "Stop and remove", then its agent ends',
    async ({ orcaPage: page, electronApp, claudeStub }, testInfo) => {
      // The chat's agent starts and takes a turn before the first check.
      chatTest.setTimeout(180_000)
      const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const chat = await openStubChat(page, claudeStub.command)
      // The stub runs a prompt containing "slow" until it is interrupted.
      await page.keyboard.type('slow')
      await chat.send.click()
      const chatRecords = async () =>
        (await listed(userDataDir))
          .filter(
            (session) =>
              session.surface.kind === 'chat' && session.surface.sessionId === chat.sessionId
          )
          .map(({ id, status, alive }) => ({ id, status, alive }))
      await expect
        .poll(chatRecords, { timeout: 60_000 })
        .toEqual([
          { id: expect.stringMatching(/^local:claude:(?!seal-)/), status: 'working', alive: true }
        ])
      const [{ id }] = await chatRecords()
      const agent = readClaudeStubLaunches(claudeStub.launchLog).find((launch) =>
        launch.args.join(' ').includes(id.slice('local:claude:'.length))
      )!
      expect(runs(agent.pid)).toBe(true)

      const row = page.getByTestId('active-agents').locator(`[data-live-session-row="${id}"]`)
      await expect(row).toHaveCount(1)
      await stopAndRemoveFromRow(page, row, testInfo)

      await expect.poll(() => runs(agent.pid), { timeout: 30_000 }).toBe(false)
      expect(await chatRecords()).toEqual([])
      await expect(row).toHaveCount(0)
    }
  )
})
