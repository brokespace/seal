// Where the sidebar lists a session: under its workspace's card, or in the Unassigned group when no workspace holds it.
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'

/** Sizes the hidden window so the sidebar lists its projects. */
export async function showSidebar(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('[data-repo-header-id]').first()).toBeVisible({ timeout: 60_000 })
}

function inSidebar(page: Page, row: string): Locator {
  return page.locator(`[data-workspace-session-rows] ${row}`)
}

export function sidebarSessionRow(page: Page, sessionId: string): Locator {
  return inSidebar(page, `[data-live-session-row="${sessionId}"]`)
}

/** The session's row under one workspace's card. */
export function workspaceSessionRow(page: Page, worktreeId: string, sessionId: string): Locator {
  return page.locator(
    `[data-worktree-sidebar] [data-workspace-session-rows="${worktreeId}"] [data-live-session-row="${sessionId}"]`
  )
}

/** Every row of one machine's sessions: a session's id begins with its machine's. */
export function sidebarMachineSessionRows(page: Page, hostId: string): Locator {
  return inSidebar(page, `[data-live-session-row^="${hostId}:"]`)
}
