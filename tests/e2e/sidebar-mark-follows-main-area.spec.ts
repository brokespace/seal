// The sidebar marks what the main area shows: the row of the session on view, else the card of the workspace on view.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import {
  clickSidebarSessionRow,
  readWorkspaceTabOnView,
  showSidebar
} from './helpers/agent-session-sidebar-open'
import { externalAgentSessionTab } from './helpers/external-agent-session-tab'
import { expect, test } from './helpers/orca-app'
import {
  seedLiveSession,
  stopAllSeededSessions,
  waitForLiveSessions,
  type SeededLiveSession
} from './helpers/seeded-live-sessions'
import { sidebarSessionRow, workspaceSessionRow } from './helpers/sidebar-session-row'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type Scene = {
  worktreeId: string
  card: Locator
  /** A session of the workspace on view, listed on its card. */
  own: SeededLiveSession
  ownRow: Locator
  /** A session no workspace holds, listed under the project its folder names. */
  outside: SeededLiveSession
  outsideRow: Locator
}

/** The workspace on view shows its terminal; one session runs in it and one in a folder no workspace has. */
async function setScene(
  page: Page,
  electronApp: ElectronApplication,
  cleanup: (remove: () => Promise<void>) => void
): Promise<Scene> {
  await showSidebar(page)
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  const workspacePath = await page.evaluate(
    (id) => window.__store!.getState().getKnownWorktreeById(id)!.path,
    worktreeId
  )
  const parent = mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-sidebar-mark-'))
  cleanup(async () => rmSync(parent, { recursive: true, force: true }))
  const folder = path.join(parent, 'experiments')
  mkdirSync(folder)
  const own = await seedLiveSession(electronApp, {
    cwd: workspacePath,
    status: 'your-turn',
    title: 'Tidy the dev workspace'
  })
  // Ended: a running one on this machine would get a workspace made for it.
  const outside = await seedLiveSession(electronApp, {
    cwd: folder,
    status: 'your-turn',
    title: 'Test the pasted experiment',
    running: false
  })
  await waitForLiveSessions(page, { [own.id]: 'your-turn', [outside.id]: 'done' })
  // Ended sessions start folded away.
  await page
    .locator('[data-session-group$=":experiments"] [data-workspace-sessions-finished-toggle]')
    .click()
  const ownRow = workspaceSessionRow(page, worktreeId, own.id)
  await expect(ownRow).toBeVisible({ timeout: 30_000 })
  return {
    worktreeId,
    card: page.locator(
      `[data-worktree-sidebar] [data-worktree-id="${worktreeId}"] [data-worktree-card-surface]`
    ),
    own,
    ownRow,
    outside,
    outsideRow: sidebarSessionRow(page, outside.id)
  }
}

const MARKED_CARDS = '[data-worktree-sidebar] [data-worktree-card-active]'
const MARKED_ROWS =
  '[data-worktree-sidebar] :is([data-live-session-row][data-current], [data-live-session-row][data-highlighted])'
// The ring a row gets when it is opened fades by itself.
const RING_FADE = { timeout: 15_000 }

test.afterEach(async () => {
  await stopAllSeededSessions()
})

// Each session is listed by a scan that comes 3 to 12 s after it is seeded, on top of app start.
test.describe.configure({ timeout: 150_000 })

test('a session no workspace holds, opened while a workspace was on view, is the one thing marked', async ({
  orcaPage: page,
  electronApp,
  registerPostElectronShutdownCleanup
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  const scene = await setScene(page, electronApp, registerPostElectronShutdownCleanup)
  await expect(scene.card).toHaveAttribute('data-worktree-card-active', 'primary')

  await clickSidebarSessionRow(page, scene.outside.id)
  // It has no workspace of its own, so its tab opens in the one on view.
  await expect
    .poll(() => readWorkspaceTabOnView(page))
    .toEqual({
      worktreeId: scene.worktreeId,
      contentType: 'external-agent-session',
      entityId: scene.outside.id
    })

  await expect(scene.outsideRow).toHaveAttribute('data-current', 'true')
  await expect(page.locator(MARKED_CARDS)).toHaveCount(0)
  await expect(page.locator('[data-worktree-family-segment]')).toHaveCount(0)
  await expect(page.locator(MARKED_ROWS)).toHaveCount(1, RING_FADE)
  await expect(scene.ownRow).not.toHaveAttribute('data-current')
})

test('switching tabs moves the mark between the session row and the workspace card', async ({
  orcaPage: page,
  electronApp,
  registerPostElectronShutdownCleanup
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  const scene = await setScene(page, electronApp, registerPostElectronShutdownCleanup)
  const terminalTabId = (await readWorkspaceTabOnView(page))!.entityId
  const terminalTab = page.locator(`[data-testid="sortable-tab"][data-tab-id="${terminalTabId}"]`)
  // A double click keeps the tab, so it stays in the strip to come back to.
  await scene.outsideRow.dblclick()
  const sessionTab = await externalAgentSessionTab(page, scene.outside.id)
  await expect(scene.outsideRow).toHaveAttribute('data-current', 'true')
  await expect(page.locator(MARKED_CARDS)).toHaveCount(0)

  await terminalTab.click()
  await expect(scene.card).toHaveAttribute('data-worktree-card-active', 'primary')
  await expect(page.locator(MARKED_CARDS)).toHaveCount(1)
  await expect(page.locator(MARKED_ROWS)).toHaveCount(0, RING_FADE)

  await sessionTab.click()
  await expect(scene.outsideRow).toHaveAttribute('data-current', 'true')
  await expect(page.locator(MARKED_CARDS)).toHaveCount(0)
  await expect(page.locator(MARKED_ROWS)).toHaveCount(1, RING_FADE)
})

test('a workspace showing its own screen marks its card and none of its session rows', async ({
  orcaPage: page,
  electronApp,
  registerPostElectronShutdownCleanup
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  const scene = await setScene(page, electronApp, registerPostElectronShutdownCleanup)

  await expect(scene.card).toHaveAttribute('data-worktree-card-active', 'primary')
  await expect(page.locator(MARKED_CARDS)).toHaveCount(1)
  await expect(page.locator(MARKED_ROWS)).toHaveCount(0)
})
