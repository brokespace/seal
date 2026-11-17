// A session no workspace holds is dragged from the sidebar like any other: dropped on the main area it opens there.
// An ended session stands for one: a running one on this machine gets a workspace made for it.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  externalAgentSessionPane,
  readWorkspaceTabOnView,
  showSidebar
} from './helpers/agent-session-sidebar-open'
import { expect, test } from './helpers/orca-app'
import {
  seedLiveSession,
  stopAllSeededSessions,
  waitForLiveSessions
} from './helpers/seeded-live-sessions'
import { sidebarSessionRow } from './helpers/sidebar-session-row'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.afterEach(async () => {
  await stopAllSeededSessions()
})

test('a session with a project but no workspace is dragged onto the main area and opens in the workspace on view', async ({
  orcaPage: page,
  electronApp,
  registerPostElectronShutdownCleanup
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  test.setTimeout(120_000)
  await showSidebar(page)
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)

  const parent = mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-session-drag-'))
  registerPostElectronShutdownCleanup(async () => rmSync(parent, { recursive: true, force: true }))
  const folder = path.join(parent, 'fitness')
  mkdirSync(folder)
  const session = await seedLiveSession(electronApp, {
    cwd: folder,
    status: 'your-turn',
    title: 'Plan the fitness week',
    running: false
  })
  await waitForLiveSessions(page, { [session.id]: 'done' })

  // Its folder names its project, under a header of the list like any project's; ended sessions start folded away.
  await expect(
    page.locator('[data-worktree-virtual-row-key="hdr:active-agents:project:fitness"]')
  ).toContainText('fitness')
  await page
    .locator('[data-session-group$=":fitness"] [data-workspace-sessions-finished-toggle]')
    .click()
  const row = sidebarSessionRow(page, session.id)
  await expect(row).toBeVisible({ timeout: 30_000 })
  // Sessions found on the machine can push the row below the fold; hovering scrolls it in.
  await row.hover()
  const area = page.locator('[data-split-view-drop-area]')
  const areaBox = (await area.boundingBox())!
  await page.mouse.down()
  await page.mouse.move(areaBox.x + areaBox.width / 2, areaBox.y + areaBox.height / 2, {
    steps: 12
  })
  await expect(page.locator('[data-split-view-drop-preview]')).toBeVisible()
  await page.mouse.up()

  await expect
    .poll(() => readWorkspaceTabOnView(page))
    .toEqual({ worktreeId, contentType: 'external-agent-session', entityId: session.id })
  await expect(externalAgentSessionPane(page, session.id)).toBeVisible()
})
