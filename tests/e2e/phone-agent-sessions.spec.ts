// The phone's session list and chat view, as the mobile web page draws them, against a desktop
// running all three kinds of session: a chat, an agent CLI in a pane and one started outside Seal.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect } from './helpers/orca-app'
import {
  STUB_CLI_KEEPS_WORKING,
  configureDiscoverableStubAgentClis,
  launchDiscoverableStubAgentCli,
  writeDiscoverableStubAgentCli
} from './helpers/discoverable-stub-agent-cli'
import { getGoldenStubAgentLaunchEnv } from './helpers/golden-stub-agent'
import { createDesktopMobilePairingOffer } from './helpers/paired-electron-client'
import { PHONE_HOST_ROUTE, closePhoneBundle, openPhoneWebPage } from './helpers/phone-web-page'
import {
  refreshLiveSessions,
  seedLiveSession,
  stopAllSeededSessions,
  waitForLiveSessions
} from './helpers/seeded-live-sessions'
import { addSeedWorkspaces, removeSeedWorkspaces } from './helpers/seeded-workspaces'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { SUPPORTED, openStubChat, test as base } from './helpers/structured-claude-stub'
import { sendToTerminal } from './helpers/terminal'

const test = base.extend({
  // The chat's Claude stub first; the fixture directory makes the tab bar list Codex for the pane.
  launchEnv: async ({ claudeStub }, provideFixture) => {
    const golden = Object.values(getGoldenStubAgentLaunchEnv())[0] ?? ''
    await provideFixture({
      PATH: [path.dirname(claudeStub.command), golden].join(path.delimiter)
    })
  }
})

test.afterAll(async () => {
  await stopAllSeededSessions()
  await closePhoneBundle()
})

test('the phone lists every session by project and workspace and opens each in the chat view', async ({
  orcaPage: page,
  electronApp,
  claudeStub,
  registerPostElectronShutdownCleanup
}) => {
  test.skip(!SUPPORTED, 'the agent stubs are POSIX-only')
  // Three agents to start, a scan to list them, a bundle build and three sessions to open.
  test.setTimeout(360_000)
  const stubDir = mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-phone-sessions-'))
  registerPostElectronShutdownCleanup(async () => rmSync(stubDir, { recursive: true, force: true }))

  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  const codexCli = writeDiscoverableStubAgentCli(stubDir, 'codex')
  await configureDiscoverableStubAgentClis(page, [codexCli])
  const pane = await launchDiscoverableStubAgentCli(page, codexCli)
  await sendToTerminal(page, pane.ptyId, `Pane task ${STUB_CLI_KEEPS_WORKING}\r`)

  const chat = await openStubChat(page, claudeStub.command)
  await page.keyboard.type('Chat task')
  await chat.send.click()
  await expect(chat.reply).toBeVisible({ timeout: 30_000 })

  const [workspace] = await addSeedWorkspaces(page, 1)
  try {
    const asking = await seedLiveSession(electronApp, {
      cwd: workspace.path,
      status: 'waiting-input',
      title: 'Outside question'
    })
    await waitForLiveSessions(page, { [asking.id]: 'waiting-input' })
    await expect
      .poll(async () =>
        (await refreshLiveSessions(page)).map((session) => session.surface.kind).sort()
      )
      .toEqual(['chat', 'cli', 'external'])
    const sessions = await refreshLiveSessions(page)
    const idOf = (kind: 'chat' | 'cli'): string =>
      sessions.find((session) => session.surface.kind === kind)?.id ?? ''
    const machine = sessions[0].machine.label
    const listHref = `${PHONE_HOST_ROUTE}/seal/sessions`

    const offer = await createDesktopMobilePairingOffer(page)
    const phone = await openPhoneWebPage(electronApp, offer, listHref)
    try {
      const view = phone.page
      const rowIds = (testIdPrefix: string) =>
        view
          .locator(`[data-testid^="${testIdPrefix}"]`)
          .evaluateAll(
            (rows, prefix) =>
              rows.map((row) => (row.getAttribute('data-testid') ?? '').slice(prefix.length)),
            testIdPrefix
          )

      // Only the session with a question waits on the person; it stays listed under its workspace too.
      await expect(view.getByTestId('live-sessions-needs-you')).toBeVisible({ timeout: 30_000 })
      expect(await rowIds('live-session-needs-you-row-')).toEqual([asking.id])

      // The chat and the pane agent run in one folder, the outside session in another: two workspaces,
      // each under a project header and badged with its machine.
      const workspaces = await view.getByTestId('live-session-project').evaluateAll((projects) =>
        projects.flatMap((project) =>
          [...project.querySelectorAll('[data-testid="live-session-workspace"]')].map(
            (workspace) => ({
              machine: workspace.querySelector('[data-testid="live-session-machine-badge"]')
                ?.textContent,
              sessions: [...workspace.querySelectorAll('[data-testid^="live-session-row-"]')]
                .map((row) => (row.getAttribute('data-testid') ?? '').slice(17))
                .sort()
            })
          )
        )
      )
      expect(workspaces.sort((a, b) => b.sessions.length - a.sessions.length)).toEqual([
        { machine, sessions: [idOf('chat'), idOf('cli')].sort() },
        { machine, sessions: [asking.id] }
      ])

      // An outside session opens in the chat view, from the registry's transcript.
      await view.getByTestId(`live-session-needs-you-row-${asking.id}`).click()
      const outsideChat = view
        .getByTestId('live-session-chat-screen')
        .getByTestId('native-chat-view')
      await expect(
        outsideChat.getByText('Which limit should apply to anonymous clients?')
      ).toBeVisible({ timeout: 30_000 })

      // Its recap is the host's answer, not the line shown while the phone waits for one.
      await view.getByLabel('Session actions').click()
      await view.getByText('Recap', { exact: true }).click()
      await expect(view.getByText('Refresh', { exact: true })).toBeVisible()
      await expect(view.getByText('Reading the session…')).toHaveCount(0)
      await view.getByText('Done', { exact: true }).click()

      // So does an agent CLI in a Seal pane.
      await phone.open(listHref)
      await view.getByTestId(`live-session-row-${idOf('cli')}`).click()
      const paneChat = view.getByTestId('live-session-chat-screen').getByTestId('native-chat-view')
      await expect(paneChat.getByText(`Pane task ${STUB_CLI_KEEPS_WORKING}`)).toBeVisible({
        timeout: 30_000
      })
      await expect(paneChat.getByTestId('native-chat-composer')).toBeVisible()

      // A chat opens as chats do: its own tab in its workspace.
      await phone.open(listHref)
      await view.getByTestId(`live-session-row-${idOf('chat')}`).click()
      await expect
        .poll(() => phone.handoffs.at(-1) ?? '', { timeout: 30_000 })
        .toContain(encodeURIComponent(`agent-session:${chat.sessionId}:`))
      await expect(view.getByTestId('native-chat-view').getByText('Stub reply.')).toBeVisible({
        timeout: 30_000
      })
      expect(phone.faults).toEqual([])
    } finally {
      await phone.dispose()
    }
  } finally {
    await stopAllSeededSessions()
    await removeSeedWorkspaces(page, [workspace])
  }
})
