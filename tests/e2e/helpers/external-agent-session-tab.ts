// A session Seal holds no chat or pane for opens as a workspace tab of its own, named by its registry id.
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'

/** The session's tab in its workspace's tab strip, once it has one. */
export async function externalAgentSessionTab(page: Page, sessionId: string): Promise<Locator> {
  let tabId: string | null = null
  await expect
    .poll(
      async () => {
        tabId = await page.evaluate(
          (id) =>
            Object.values(window.__store?.getState().unifiedTabsByWorktree ?? {})
              .flat()
              .find((tab) => tab.contentType === 'external-agent-session' && tab.entityId === id)
              ?.id ?? null,
          sessionId
        )
        return tabId
      },
      { message: `no workspace tab opened for the session ${sessionId}` }
    )
    .not.toBeNull()
  return page.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
}
