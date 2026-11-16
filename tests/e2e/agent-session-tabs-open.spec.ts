// T4.1: a sidebar row opens its session in the tab that shows it, in the workspace it runs in.

import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clickSidebarSessionRow,
  externalAgentSessionPane,
  readExternalAgentSessionTabWorkspaces,
  readWorkspaceTabOnView,
  showSidebar
} from './helpers/agent-session-sidebar-open'
import {
  configureDiscoverableStubAgentClis,
  launchDiscoverableStubAgentCli,
  writeDiscoverableStubAgentCli
} from './helpers/discoverable-stub-agent-cli'
import { readLiveSessions, waitForLiveSession } from './helpers/live-session-registry'
import { expect } from './helpers/orca-app'
import {
  seedLiveSession,
  stopAllSeededSessions,
  waitForLiveSessions
} from './helpers/seeded-live-sessions'
import { addSeedWorkspaces, removeSeedWorkspaces } from './helpers/seeded-workspaces'
import { dismissSetupScriptPrompts } from './helpers/sidebar-setup-prompt'
import {
  ensureTerminalVisible,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { SUPPORTED, openStubChat, test } from './helpers/structured-claude-stub'

test.afterEach(async () => {
  await stopAllSeededSessions()
})

test('a chat, a CLI pane and an outside session each open from their row in their own tab and workspace', async ({
  orcaPage: page,
  electronApp,
  claudeStub,
  registerPostElectronShutdownCleanup
}) => {
  test.skip(
    !SUPPORTED,
    'Sessions are not scanned for on Windows, and the Claude stub is POSIX-only'
  )
  // Three sessions of three kinds, each listed by a scan that comes 3 to 12 s after it starts.
  test.setTimeout(240_000)
  await showSidebar(page)
  await waitForSessionReady(page)
  const mainWorktreeId = await waitForActiveWorktree(page)
  const [chatWorkspace, outsideWorkspace] = await addSeedWorkspaces(page, 2)
  try {
    // The CLI first: opening the chat points the Claude launch command at the chat stub.
    const stubDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-stub-cli-'))
    registerPostElectronShutdownCleanup(async () =>
      rmSync(stubDir, { recursive: true, force: true })
    )
    const claudeCli = writeDiscoverableStubAgentCli(stubDir, 'claude')
    await ensureTerminalVisible(page)
    await configureDiscoverableStubAgentClis(page, [claudeCli])
    const cli = await launchDiscoverableStubAgentCli(page, claudeCli)
    const cliId = `local:claude:${cli.sessionId}`
    const cliTerminalTabId = cli.paneKey.slice(0, cli.paneKey.lastIndexOf(':'))

    await switchToWorktree(page, chatWorkspace.id)
    await expect.poll(() => waitForActiveWorktree(page)).toBe(chatWorkspace.id)
    const chat = await openStubChat(page, claudeStub.command)
    await chat.composer.pressSequentially('Say hello')
    // Enter, not the Send button: the CLI's launch raised a toast over that corner.
    await page.keyboard.press('Enter')
    await expect(chat.reply).toBeVisible({ timeout: 30_000 })

    const outside = await seedLiveSession(electronApp, {
      cwd: outsideWorkspace.path,
      status: 'your-turn',
      title: 'Outside session to open'
    })
    await waitForLiveSessions(page, { [outside.id]: 'your-turn' })
    await waitForLiveSession(page, cliId, (s) => s.surface.kind === 'cli')
    const chatRecordId = async (): Promise<string | null> =>
      (await readLiveSessions(page)).find(
        (s) => s.surface.kind === 'chat' && s.surface.sessionId === chat.sessionId
      )?.id ?? null
    await expect.poll(chatRecordId, { timeout: 30_000 }).not.toBeNull()
    // Adding a workspace offers a setup script in a card that lies over the lower rows.
    await dismissSetupScriptPrompts(page)

    await clickSidebarSessionRow(page, outside.id)
    await expect
      .poll(() => readWorkspaceTabOnView(page))
      .toEqual({
        worktreeId: outsideWorkspace.id,
        contentType: 'external-agent-session',
        entityId: outside.id
      })
    await expect(externalAgentSessionPane(page, outside.id)).toBeVisible()
    expect(await readExternalAgentSessionTabWorkspaces(page, outside.id)).toEqual([
      outsideWorkspace.id
    ])

    await clickSidebarSessionRow(page, (await chatRecordId())!)
    await expect
      .poll(() => readWorkspaceTabOnView(page))
      .toEqual({
        worktreeId: chatWorkspace.id,
        contentType: 'agent-session',
        entityId: chat.sessionId
      })

    await clickSidebarSessionRow(page, cliId)
    await expect
      .poll(() => readWorkspaceTabOnView(page))
      .toEqual({ worktreeId: mainWorktreeId, contentType: 'terminal', entityId: cliTerminalTabId })

    // A second click shows the tab the first one made.
    await clickSidebarSessionRow(page, outside.id)
    await expect
      .poll(() => readWorkspaceTabOnView(page))
      .toEqual({
        worktreeId: outsideWorkspace.id,
        contentType: 'external-agent-session',
        entityId: outside.id
      })
    await clickSidebarSessionRow(page, outside.id)
    await expect(externalAgentSessionPane(page, outside.id)).toBeVisible()
    expect(await readExternalAgentSessionTabWorkspaces(page, outside.id)).toEqual([
      outsideWorkspace.id
    ])
    expect(await readWorkspaceTabOnView(page)).toMatchObject({ entityId: outside.id })
  } finally {
    await removeSeedWorkspaces(page, [chatWorkspace, outsideWorkspace])
  }
})
