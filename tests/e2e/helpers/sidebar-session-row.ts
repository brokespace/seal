// Where the sidebar lists a session: under its workspace's card, or in the Unassigned group when no workspace holds it.
import type { Locator, Page } from '@stablyai/playwright-test'

function inSidebar(page: Page, row: string): Locator {
  return page.locator(`[data-workspace-session-rows] ${row}`)
}

export function sidebarSessionRow(page: Page, sessionId: string): Locator {
  return inSidebar(page, `[data-live-session-row="${sessionId}"]`)
}

/** Every row of one machine's sessions: a session's id begins with its machine's. */
export function sidebarMachineSessionRows(page: Page, hostId: string): Locator {
  return inSidebar(page, `[data-live-session-row^="${hostId}:"]`)
}
