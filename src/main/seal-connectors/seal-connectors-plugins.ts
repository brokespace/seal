import type { AgentPluginListing } from '../../shared/agent-plugins/agent-plugin-types'
import {
  isChatGptAppListing,
  type SealConnectorsCatalog
} from '../../shared/seal-connectors/seal-connectors-catalog'
import {
  APPLIES_TO_ALL,
  type AppliesTo,
  type PluginEntry,
  type ProjectOverride,
  type SealConnectorsConfig
} from '../../shared/seal-connectors/seal-connectors-types'
import { readAgentPluginCatalog } from '../agent-plugins/agent-plugin-catalog-read'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { getSealConnectorsHost, type SealPluginLibrary } from './seal-connectors-host'
import { readPluginParts } from './seal-plugin-contents'

const CATALOG_TTL_MS = 60_000

export type SealPluginInstallRequest = {
  name: string
  marketplace: string
  harness: 'claude' | 'codex'
  appliesTo?: AppliesTo
  projectOverrides?: ProjectOverride[]
}

type PluginsDeps = { connection: MachineConnection; library: SealPluginLibrary }

let installedLibrary: SealPluginLibrary | null = null
let cachedCatalog: { at: number; machineId: string; value: SealConnectorsCatalog } | null = null
let queue: Promise<unknown> = Promise.resolve()

/** The startup wiring hands over this host's plugin library once it exists. */
export function setSealPluginLibrary(library: SealPluginLibrary | null): void {
  installedLibrary = library
}

export function getSealPluginLibrary(): SealPluginLibrary {
  if (!installedLibrary) {
    throw new Error('The plugin library is not ready on this host yet')
  }
  return installedLibrary
}

function requireHost() {
  const host = getSealConnectorsHost()
  if (!host) {
    throw new Error('Connectors are not ready on this host yet')
  }
  return host
}

/** Installs and removals edit one list and one library, so they run one at a time. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

/** Claude Code's and Codex's plugin catalogs merged, without plugins that only run inside ChatGPT. */
export async function readSealConnectorsCatalog(
  connection: MachineConnection,
  options: { refresh?: boolean } = {}
): Promise<SealConnectorsCatalog> {
  const cached = cachedCatalog
  if (
    cached &&
    !options.refresh &&
    cached.machineId === connection.machineId &&
    Date.now() - cached.at < CATALOG_TTL_MS
  ) {
    return { ...cached.value, added: addedPluginIds() }
  }
  const catalog = await readAgentPluginCatalog(connection)
  const value: SealConnectorsCatalog = {
    ...catalog,
    entries: catalog.entries.flatMap((entry) => {
      const listings = entry.listings.filter(
        (listing) => !isChatGptAppListing(listing, entry.components)
      )
      return listings.length > 0 ? [{ ...entry, listings }] : []
    }),
    added: []
  }
  cachedCatalog = { at: Date.now(), machineId: connection.machineId, value }
  return { ...value, added: addedPluginIds() }
}

function addedPluginIds(): string[] {
  return (
    getSealConnectorsHost()
      ?.config()
      .plugins.map((plugin) => plugin.id) ?? []
  )
}

function findListing(
  listings: readonly AgentPluginListing[],
  request: SealPluginInstallRequest
): AgentPluginListing | null {
  return (
    listings.find(
      (listing) =>
        listing.harness === request.harness && listing.marketplace === request.marketplace
    ) ?? null
  )
}

/**
 * Adds a plugin to Seal's list: fetches it into this host's library, then lists its MCP servers
 * as connectors and its skills, all in one edit.
 */
export function installSealPlugin(
  request: SealPluginInstallRequest,
  deps: PluginsDeps
): Promise<SealConnectorsConfig> {
  return serialized(async () => {
    const host = requireHost()
    const { connection, library } = deps
    const catalog = await readSealConnectorsCatalog(connection)
    const catalogEntry = catalog.entries.find((entry) => entry.name === request.name)
    const listing = catalogEntry ? findListing(catalogEntry.listings, request) : null
    if (!catalogEntry || !listing) {
      const hidden = request.harness === 'codex'
      throw new Error(
        hidden
          ? `${request.name} is not an installable Codex plugin (ChatGPT apps only run inside ChatGPT)`
          : `${request.name} is not offered by the ${request.marketplace} marketplace`
      )
    }
    const before = host.config()
    const existing = before.plugins.find((plugin) => plugin.id === listing.id)
    const entry: PluginEntry = existing ?? {
      id: listing.id,
      name: request.name,
      marketplace: listing.marketplace,
      harness: listing.harness,
      version: listing.version,
      description: catalogEntry.description.slice(0, 2000),
      connectorIds: [],
      skillNames: [],
      enabled: true,
      appliesTo: request.appliesTo ?? APPLIES_TO_ALL,
      projectOverrides: request.projectOverrides ?? []
    }
    // The library fetches against the list with the plugin in it; the saved list changes only after.
    const draft = existing ? before : { ...before, plugins: [...before.plugins, entry] }
    // Another list's reconcile (a sync) must not uninstall the plugin while this install is open.
    library.markPending(entry.id)
    try {
      await library.reconcile(draft)
      let parts: Awaited<ReturnType<typeof readPluginParts>>
      try {
        parts = await readPluginParts(connection, library, entry, before)
      } catch (error) {
        if (!existing) {
          library.clearPending(entry.id)
          await library.reconcile(before)
        }
        throw error
      }
      return host.editConfig((config) => {
        const current = config.plugins.find((plugin) => plugin.id === entry.id)
        const knownConnectors = new Set(config.connectors.map((connector) => connector.id))
        const knownSkills = new Set(config.skills.map((skill) => skill.id))
        const stored: PluginEntry = {
          ...(current ?? entry),
          version: parts.version ?? entry.version,
          description: entry.description || parts.description.slice(0, 2000),
          connectorIds: parts.connectors.map((connector) => connector.id),
          skillNames: parts.skills.map((skill) => skill.name)
        }
        // A reinstall keeps what the plugin already brought, with its sign-ins and scopes.
        return {
          ...config,
          plugins: [...config.plugins.filter((plugin) => plugin.id !== entry.id), stored],
          connectors: [
            ...config.connectors,
            ...parts.connectors.filter((connector) => !knownConnectors.has(connector.id))
          ],
          skills: [...config.skills, ...parts.skills.filter((skill) => !knownSkills.has(skill.id))]
        }
      })
    } finally {
      library.clearPending(entry.id)
    }
  })
}

function withoutPluginParts(config: SealConnectorsConfig, pluginId: string): SealConnectorsConfig {
  const ownedBy = (source: { kind: string; pluginId?: string }): boolean =>
    source.kind === 'plugin' && source.pluginId === pluginId
  return {
    ...config,
    plugins: config.plugins.filter((plugin) => plugin.id !== pluginId),
    connectors: config.connectors.filter((connector) => !ownedBy(connector.source)),
    skills: config.skills.filter((skill) => !ownedBy(skill.source))
  }
}

/** Drops a plugin, the connectors and skills it brought, and those connectors' sign-ins. */
export function removeSealPlugin(
  pluginId: string,
  deps: Pick<PluginsDeps, 'library'>
): Promise<SealConnectorsConfig> {
  return serialized(async () => {
    const host = requireHost()
    const doomed = host
      .config()
      .connectors.filter(
        (connector) => connector.source.kind === 'plugin' && connector.source.pluginId === pluginId
      )
    const next = host.editConfig((config) => withoutPluginParts(config, pluginId))
    for (const connector of doomed) {
      for (const signIn of connector.signIns) {
        host.removeSignIn(signIn.id)
      }
    }
    await deps.library.reconcile(next)
    return next
  })
}
