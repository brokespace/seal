import type { Tab, TabContentType } from '../../../../../shared/tab-types'

const EXTERNAL_TAB: TabContentType = 'external-agent-session'

type TabsByWorkspace = Readonly<
  Record<string, readonly Pick<Tab, 'id' | 'contentType'>[] | undefined>
>

// Every mounted chat asks on each tab change; the map is new whenever a tab changes.
const indexes = new WeakMap<TabsByWorkspace, ReadonlyMap<string, string>>()

/** The workspace holding an external session's tab: its chat's links, images and mentions resolve there. */
export function externalAgentSessionTabWorkspace(
  tabsByWorkspace: TabsByWorkspace | undefined,
  tabId: string
): string | null {
  if (!tabsByWorkspace) {
    return null
  }
  let index = indexes.get(tabsByWorkspace)
  if (!index) {
    const byTabId = new Map<string, string>()
    for (const [workspaceId, tabs] of Object.entries(tabsByWorkspace)) {
      for (const tab of tabs ?? []) {
        if (tab.contentType === EXTERNAL_TAB) {
          byTabId.set(tab.id, workspaceId)
        }
      }
    }
    index = byTabId
    indexes.set(tabsByWorkspace, index)
  }
  return index.get(tabId) ?? null
}
