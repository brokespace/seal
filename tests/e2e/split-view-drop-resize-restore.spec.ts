// Prove split view's core loop in the real app: a sidebar card dropped on the main area splits it, the splitter resizes the panes, and a restart brings both back.

import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { addRepoWithWorkspaces, writeWorkspaceMeta } from './helpers/repo-with-workspaces'
import { dismissSetupScriptPrompts } from './helpers/sidebar-setup-prompt'
import { ensureTerminalVisible, switchToWorktree, waitForSessionReady } from './helpers/store'

const VIEWPORT = { width: 1_400, height: 800 }
const SHOWN_TITLE = 'repo / Shown first'
const DROPPED_TITLE = 'repo / Dropped second'

function splitViewPanes(page: Page): Locator {
  return page.locator('[data-split-view-layer]').getByRole('group')
}

async function widthShareOfMainArea(page: Page, element: Locator): Promise<number> {
  const area = await page.locator('[data-split-view-drop-area]').boundingBox()
  const box = await element.boundingBox()
  return area && box ? box.width / area.width : Number.NaN
}

// A workspace is laid over its pane's empty slot rather than nested in it, so its terminal is found by position.
async function terminalFillsPaneOf(page: Page, worktreeId: string): Promise<boolean> {
  return page
    .locator(`[data-split-view-workspace-slot=${JSON.stringify(worktreeId)}]`)
    .evaluate((slot) => {
      const rect = slot.getBoundingClientRect()
      const terminal = document
        .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        ?.closest('.xterm')
      if (!terminal) {
        return false
      }
      const terminalRect = terminal.getBoundingClientRect()
      return terminalRect.left >= rect.left - 1 && terminalRect.right <= rect.right + 1
    })
}

async function expectTwoWorkspacePanes(
  page: Page,
  shownId: string,
  droppedId: string
): Promise<void> {
  const panes = splitViewPanes(page)
  await expect(panes).toHaveCount(2)
  const shownPane = panes.nth(0)
  const droppedPane = panes.nth(1)
  await expect(shownPane).toHaveAccessibleName(SHOWN_TITLE)
  await expect(droppedPane).toHaveAccessibleName(DROPPED_TITLE)
  await expect(shownPane.getByRole('tab')).toHaveText([SHOWN_TITLE])
  await expect(droppedPane.getByRole('tab')).toHaveText([DROPPED_TITLE])
  await expect(shownPane.getByRole('tab', { selected: true })).toHaveText(SHOWN_TITLE)
  await expect(droppedPane.getByRole('tab', { selected: true })).toHaveText(DROPPED_TITLE)
  await expect(droppedPane).toHaveAttribute('data-split-view-pane-focused', '')
  await expect(shownPane).not.toHaveAttribute('data-split-view-pane-focused')
  await expect(page.locator('[data-split-view-placeholder]')).toHaveCount(0, { timeout: 30_000 })
  for (const worktreeId of [shownId, droppedId]) {
    await expect
      .poll(() => terminalFillsPaneOf(page, worktreeId), {
        timeout: 30_000,
        message: `no terminal is showing in the pane of ${worktreeId}`
      })
      .toBe(true)
  }
}

test('a workspace dropped on the main area splits it, resizes, and is restored after a restart', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  // Two full app launches with a quit between them.
  test.setTimeout(300_000)
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  try {
    const first = await session.launch()
    firstApp = first.app
    const page = first.page
    await waitForSessionReady(page)
    await page.setViewportSize(VIEWPORT)

    const repo = await addRepoWithWorkspaces(page, testInfo, 1)
    const shownId = repo.mainId
    const droppedId = repo.ids[0]!
    await writeWorkspaceMeta(page, [
      { worktreeId: shownId, updates: { displayName: 'Shown first' } },
      { worktreeId: droppedId, updates: { displayName: 'Dropped second' } }
    ])
    await switchToWorktree(page, shownId)
    await ensureTerminalVisible(page)
    await dismissSetupScriptPrompts(page)

    const area = page.locator('[data-split-view-drop-area]')
    await expect(area.locator('.xterm').first()).toBeVisible({ timeout: 30_000 })
    await expect(splitViewPanes(page)).toHaveCount(0)

    const card = page.locator(`[data-worktree-drag-id=${JSON.stringify(droppedId)}]`)
    // Agent sessions found on the machine can push the workspace cards below the fold.
    await card.scrollIntoViewIfNeeded()
    const cardBox = (await card.boundingBox())!
    const areaBox = (await area.boundingBox())!
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(areaBox.x + areaBox.width * 0.85, areaBox.y + areaBox.height * 0.5, {
      steps: 12
    })
    await expect(page.locator('[data-split-view-drop-preview]')).toBeVisible()
    await page.mouse.up()

    await expectTwoWorkspacePanes(page, shownId, droppedId)
    const shownPane = splitViewPanes(page).nth(0)
    await expect.poll(() => widthShareOfMainArea(page, shownPane)).toBeCloseTo(0.5, 1)

    const splitter = page.locator('.split-view-layer .tab-group-split-resize-handle')
    await expect(splitter).toHaveCount(1)
    const splitterBox = (await splitter.boundingBox())!
    const splitterY = splitterBox.y + splitterBox.height / 2
    await page.mouse.move(splitterBox.x + splitterBox.width / 2, splitterY)
    await page.mouse.down()
    await page.mouse.move(areaBox.x + areaBox.width * 0.3, splitterY, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => widthShareOfMainArea(page, shownPane)).toBeCloseTo(0.3, 1)
    await expectTwoWorkspacePanes(page, shownId, droppedId)

    await session.close(firstApp)
    firstApp = null

    const second = await session.launch()
    secondApp = second.app
    const restored = second.page
    await waitForSessionReady(restored)
    await restored.setViewportSize(VIEWPORT)

    await expectTwoWorkspacePanes(restored, shownId, droppedId)
    await expect
      .poll(() => widthShareOfMainArea(restored, splitViewPanes(restored).nth(0)))
      .toBeCloseTo(0.3, 1)
  } finally {
    // Guard each step so a failing close still runs the remaining cleanup.
    for (const app of [secondApp, firstApp]) {
      if (!app) {
        continue
      }
      try {
        await session.close(app)
      } catch {}
    }
    await session.dispose()
  }
})
