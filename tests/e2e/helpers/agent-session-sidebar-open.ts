// Opening a session from its sidebar row, and reading which workspace tab that put on view.
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { sidebarSessionRow } from './sidebar-session-row'

export type WorkspaceTabOnView = { worktreeId: string; contentType: string; entityId: string }

/** Wide enough for the sidebar to list every workspace with its sessions. */
export async function showSidebar(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('[data-repo-header-id]').first()).toBeVisible({ timeout: 60_000 })
}

/** A plain click on the session's sidebar row, as a user opens it. */
export async function clickSidebarSessionRow(page: Page, sessionId: string): Promise<void> {
  const row = sidebarSessionRow(page, sessionId)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
}

/** The active tab of the focused tab group of the workspace on view; null off the workspace view. */
export async function readWorkspaceTabOnView(page: Page): Promise<WorkspaceTabOnView | null> {
  return page.evaluate(() => {
    const state = window.__store!.getState()
    const worktreeId = state.activeView === 'terminal' ? state.activeWorktreeId : null
    if (!worktreeId) {
      return null
    }
    const groupId = state.activeGroupIdByWorktree[worktreeId]
    const group = (state.groupsByWorktree[worktreeId] ?? []).find((g) => g.id === groupId)
    const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (candidate) => candidate.id === group?.activeTabId
    )
    return tab ? { worktreeId, contentType: tab.contentType, entityId: tab.entityId } : null
  })
}

/** Every tab, in any workspace, that shows the session started outside Seal: its workspace each. */
export async function readExternalAgentSessionTabWorkspaces(
  page: Page,
  sessionId: string
): Promise<string[]> {
  return page.evaluate(
    (id) =>
      Object.entries(window.__store!.getState().unifiedTabsByWorktree).flatMap(
        ([worktreeId, tabs]) =>
          tabs
            .filter((tab) => tab.contentType === 'external-agent-session' && tab.entityId === id)
            .map(() => worktreeId)
      ),
    sessionId
  )
}

/** The chat view of a session started outside Seal, in its own workspace tab. */
export function externalAgentSessionPane(page: Page, sessionId: string): Locator {
  return page.locator(`[data-live-session-pane="${sessionId}"]`)
}
