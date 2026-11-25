import type {
  AgentPluginCatalog,
  AgentPluginCatalogEntry,
  AgentPluginListing
} from '../agent-plugins/agent-plugin-types'

/** What `seal.connectors.catalog` returns: the merged agent catalogs and what Seal already lists. */
export type SealConnectorsCatalog = AgentPluginCatalog & {
  /** Ids (`name@marketplace`) of plugins already in Seal's list. */
  added: string[]
}

/** A plugin Seal cannot deliver: Codex's ChatGPT apps only run inside ChatGPT. */
export function isChatGptAppListing(
  listing: AgentPluginListing,
  components: AgentPluginCatalogEntry['components'] = null
): boolean {
  return (
    listing.harness === 'codex' &&
    (listing.chatgptApp === true ||
      listing.installPolicy === 'NOT_AVAILABLE' ||
      (components !== null && components.apps.length > 0 && components.mcpServers.length === 0))
  )
}
