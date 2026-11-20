import { isPlainObject } from '../agent-config/agent-config-values'
import {
  AGENT_PLUGIN_COMPONENT_KINDS,
  emptyAgentPluginComponents,
  type AgentPluginCatalogEntry,
  type AgentPluginComponents,
  type AgentPluginHarness,
  type AgentPluginListing
} from './agent-plugin-types'

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : []
}

export function splitAgentPluginId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@')
  return at > 0
    ? { name: id.slice(0, at), marketplace: id.slice(at + 1) }
    : { name: id, marketplace: '' }
}

type Parsed = { listing: AgentPluginListing; name: string; description: string }

/** `claude plugin list --available --json`: installs carry `id`, offers carry `pluginId`. */
function claudeListings(output: unknown): Parsed[] {
  const record = isPlainObject(output) ? output : {}
  const userInstalls = new Map(
    list(record.installed)
      .filter((install) => install.scope === 'user')
      .map((install) => [text(install.id), install.enabled === true])
  )
  const offered = list(record.available).map((plugin): Parsed => {
    const id = text(plugin.pluginId)
    return {
      name: text(plugin.name) || splitAgentPluginId(id).name,
      description: text(plugin.description),
      listing: {
        harness: 'claude',
        id,
        marketplace: text(plugin.marketplaceName) || splitAgentPluginId(id).marketplace,
        version: text(plugin.version) || null,
        installed: userInstalls.has(id),
        enabled: userInstalls.get(id) === true,
        ...(typeof plugin.installCount === 'number' ? { installCount: plugin.installCount } : {})
      }
    }
  })
  const offeredIds = new Set(offered.map((item) => item.listing.id))
  const installedOnly = list(record.installed)
    .filter((install) => install.scope === 'user' && !offeredIds.has(text(install.id)))
    .map((install): Parsed => {
      const id = text(install.id)
      const { name, marketplace } = splitAgentPluginId(id)
      return {
        name,
        description: '',
        listing: {
          harness: 'claude',
          id,
          marketplace,
          version: text(install.version) || null,
          installed: true,
          enabled: install.enabled === true
        }
      }
    })
  return [...offered, ...installedOnly].filter((item) => item.listing.id !== '')
}

/** `codex plugin list --json --available`: both lists hold the same shape. */
function codexListings(output: unknown): Parsed[] {
  const record = isPlainObject(output) ? output : {}
  const seen = new Set<string>()
  return [...list(record.installed), ...list(record.available)].flatMap((plugin): Parsed[] => {
    const id = text(plugin.pluginId)
    if (!id || seen.has(id)) {
      return []
    }
    seen.add(id)
    return [
      {
        name: text(plugin.name) || splitAgentPluginId(id).name,
        description: text(plugin.description),
        listing: {
          harness: 'codex',
          id,
          marketplace: text(plugin.marketplaceName) || splitAgentPluginId(id).marketplace,
          version: text(plugin.version) || null,
          installed: plugin.installed === true,
          enabled: plugin.installed === true && plugin.enabled !== false,
          ...(text(plugin.installPolicy) ? { installPolicy: text(plugin.installPolicy) } : {}),
          ...(text(plugin.authPolicy) ? { authPolicy: text(plugin.authPolicy) } : {}),
          ...(isPlainObject(plugin.source) && plugin.source.source === 'remote'
            ? { chatgptApp: true }
            : {})
        }
      }
    ]
  })
}

/** Claude Code's `plugin-catalog-cache.json` lists each plugin's components; items may be names or objects. */
function componentsFrom(cache: unknown, id: string): AgentPluginComponents | null {
  const plugins =
    isPlainObject(cache) && isPlainObject(cache.catalog) && isPlainObject(cache.catalog.plugins)
      ? cache.catalog.plugins
      : null
  const entry = plugins?.[id]
  if (!isPlainObject(entry) || !isPlainObject(entry.components)) {
    return null
  }
  const components = emptyAgentPluginComponents()
  for (const kind of AGENT_PLUGIN_COMPONENT_KINDS) {
    const items = entry.components[kind]
    components[kind] = (Array.isArray(items) ? items : []).flatMap((item) => {
      const name = typeof item === 'string' ? item : isPlainObject(item) ? text(item.name) : ''
      return name ? [name] : []
    })
  }
  return components
}

const HARNESS_ORDER: Record<AgentPluginHarness, number> = { claude: 0, codex: 1 }

/**
 * One entry per plugin name across every harness's marketplaces, so a plugin both Claude Code
 * and Codex offer installs natively in each. Installed listings sort first, then the most used.
 */
export function buildAgentPluginCatalog(input: {
  claude: unknown
  codex: unknown
  claudeCatalogCache: unknown
}): AgentPluginCatalogEntry[] {
  const byName = new Map<string, AgentPluginCatalogEntry>()
  for (const item of [...claudeListings(input.claude), ...codexListings(input.codex)]) {
    const entry = byName.get(item.name) ?? {
      name: item.name,
      description: '',
      listings: [],
      components: null
    }
    entry.description ||= item.description
    entry.listings.push(item.listing)
    entry.components ??=
      item.listing.harness === 'claude'
        ? componentsFrom(input.claudeCatalogCache, item.listing.id)
        : null
    byName.set(item.name, entry)
  }
  return [...byName.values()]
    .map((entry) => ({
      ...entry,
      listings: entry.listings.toSorted(
        (a, b) =>
          HARNESS_ORDER[a.harness] - HARNESS_ORDER[b.harness] ||
          Number(b.installed) - Number(a.installed) ||
          (b.installCount ?? 0) - (a.installCount ?? 0)
      )
    }))
    .toSorted(
      (a, b) =>
        Number(b.listings.some((l) => l.installed)) - Number(a.listings.some((l) => l.installed)) ||
        Math.max(0, ...b.listings.map((l) => l.installCount ?? 0)) -
          Math.max(0, ...a.listings.map((l) => l.installCount ?? 0)) ||
        a.name.localeCompare(b.name)
    )
}

/** The one listing per harness an install uses: an installed one, else the first offered. */
export function preferredAgentPluginListings(
  entry: AgentPluginCatalogEntry
): Pick<AgentPluginListing, 'harness' | 'id'>[] {
  const chosen = new Map<AgentPluginHarness, AgentPluginListing>()
  for (const listing of entry.listings) {
    if (!chosen.has(listing.harness)) {
      chosen.set(listing.harness, listing)
    }
  }
  return [...chosen.values()].map(({ harness, id }) => ({ harness, id }))
}
