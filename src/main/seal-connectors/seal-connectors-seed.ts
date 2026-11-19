import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import {
  APPLIES_TO_ALL,
  SERVER_NAME_PATTERN,
  McpOAuthEntrySchema,
  type Connector,
  type ProjectOverride,
  type SealConnectorsConfig,
  type SignInRef,
  type SignInSecret
} from '../../shared/seal-connectors/seal-connectors-types'
import {
  SECRET_NAME,
  findHostServers,
  normalizedUrl,
  serverName,
  titleOf,
  transportKey,
  uniqueName,
  type FoundServer,
  type HostServerPaths
} from './seal-connectors-host-servers'
import { isSignedIn, readMcpOAuthEntries } from './claude-mcp-oauth-entries'
import type { SealConnectorsService } from './seal-connectors-service'

const HOST_KEY_WAIT_MS = 10_000
const HOST_KEY_POLL_MS = 100

export type SealSeedDeps = HostServerPaths & {
  defaultHome: () => string
  hostname?: string
  now?: () => number
}

type Scoped = Pick<Connector, 'enabled' | 'appliesTo' | 'projectOverrides'>

function defaultScope(enabled = true): Scoped {
  return { enabled, appliesTo: APPLIES_TO_ALL, projectOverrides: [] }
}

// Ids come from what was found, so two machines adopting the same thing list it once.
function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 20)}`
}

function signInRef(id: string, label: string, kind: SignInRef['kind'], now: number): SignInRef {
  return { ...defaultScope(), id, label, kind, createdAt: now }
}

type Draft = { connectors: Connector[]; secrets: SignInSecret[] }

/** A connector for a server found on this host, plus the static sign-in holding its secrets. */
function importServer(server: FoundServer, hostKey: string, draft: Draft, now: number): void {
  const { fields } = server
  if (carriesSecretInline(fields)) {
    // The list is plain text on every host; such a server is re-added with a static key instead.
    console.warn(
      `[seal-connectors] Skipped "${server.name}": it keeps a secret in its URL or args.`
    )
    return
  }
  const key = transportKey(fields)
  const secretEnv = Object.fromEntries(
    Object.entries(fields.env).filter(([envName]) => SECRET_NAME.test(envName))
  )
  const plainEnv = Object.fromEntries(
    Object.entries(fields.env).filter(([envName]) => !SECRET_NAME.test(envName))
  )
  const headers = fields.transport === 'stdio' ? {} : fields.headers
  const hasSecrets = Object.keys(secretEnv).length + Object.keys(headers).length > 0
  const project = server.projectPath
  // A project's own server is listed per host and secret, then switched on for each project.
  const id = project
    ? stableId('conn', key, 'project', hostKey, JSON.stringify([secretEnv, headers]))
    : stableId('conn', key)
  const override: ProjectOverride | null = project
    ? { match: project, machine: hostKey, state: 'on' }
    : null
  const index = draft.connectors.findIndex((connector) => connector.id === id)
  const listed = draft.connectors[index]
  if (listed) {
    if (override && !listed.projectOverrides.some((entry) => entry.match === override.match)) {
      draft.connectors[index] = {
        ...listed,
        projectOverrides: [...listed.projectOverrides, override]
      }
    }
    return
  }
  // A user-level copy of the same server already reaches every project.
  if (override && draft.connectors.some((connector) => connector.id === stableId('conn', key))) {
    return
  }
  const taken = new Set(draft.connectors.map((connector) => connector.name))
  const name = uniqueName(serverName(server.name), taken, server.harness)
  if (!SERVER_NAME_PATTERN.test(name)) {
    return
  }
  const ref = hasSecrets ? signInRef(stableId('si', hostKey, id), 'Imported', 'static', now) : null
  const connector: Connector = {
    // Off except where a project override turns it on.
    ...defaultScope(override ? false : fields.enabled),
    appliesTo: { ...APPLIES_TO_ALL, machines: onlyHere(fields) ? [hostKey] : 'all' },
    projectOverrides: override ? [override] : [],
    id,
    name,
    title: titleOf(server.name),
    transport:
      fields.transport === 'stdio'
        ? { type: 'stdio', command: fields.command, args: fields.args, env: plainEnv }
        : { type: 'http', url: fields.url, ...(server.oauth ? { oauth: server.oauth } : {}) },
    source: { kind: 'imported', fromHostKey: hostKey, fromHarness: server.harness },
    auth: hasSecrets ? 'static' : server.oauth ? 'oauth' : 'none',
    signIns: ref ? [ref] : [],
    disabledTools: []
  }
  if (ref) {
    draft.secrets.push({
      kind: 'static',
      id: ref.id,
      connectorId: id,
      headers,
      env: secretEnv,
      updatedAt: now
    })
  }
  draft.connectors.push(connector)
}

const SECRET_FLAG = /^--?([a-z0-9_-]+)(=.+)?$/i

function carriesSecretInline(fields: FoundServer['fields']): boolean {
  if (fields.transport !== 'stdio') {
    try {
      return [...new URL(fields.url).searchParams.keys()].some((name) => SECRET_NAME.test(name))
    } catch {
      return false
    }
  }
  return fields.args.some((arg) => SECRET_NAME.test(SECRET_FLAG.exec(arg)?.[1] ?? ''))
}

/** A server named by its path on this disk, or one listening on this machine, works only here. */
function onlyHere(fields: FoundServer['fields']): boolean {
  if (fields.transport === 'stdio') {
    return /[\\/]/.test(fields.command)
  }
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(fields.url).hostname)
  } catch {
    return false
  }
}

/** Adopts Claude Code's own MCP sign-ins into connectors, leaving any the store already holds alone. */
async function adoptClaudeSignIns(
  service: SealConnectorsService,
  deps: SealSeedDeps,
  hostKey: string,
  draft: Draft,
  now: number
): Promise<void> {
  const entries = await readMcpOAuthEntries(deps.defaultHome())
  const known = new Set(
    draft.connectors.flatMap((connector) =>
      connector.signIns.flatMap((ref) => {
        const secret = service.signIn(ref.id)
        return secret?.kind === 'oauth' ? [secret.mcpOAuthKey] : []
      })
    )
  )
  const machine = deps.hostname ?? hostname()
  for (const [key, raw] of Object.entries(entries)) {
    const parsed = McpOAuthEntrySchema.safeParse(raw)
    if (
      !parsed.success ||
      !isSignedIn(raw) ||
      !parsed.data.refreshToken ||
      key.startsWith('claude.ai') ||
      parsed.data.serverName.includes('claude.ai') ||
      known.has(key)
    ) {
      continue
    }
    const entry = parsed.data
    const url = normalizedUrl(entry.serverUrl)
    let index = draft.connectors.findIndex(
      (connector) =>
        connector.transport.type === 'http' && normalizedUrl(connector.transport.url) === url
    )
    if (index === -1) {
      const taken = new Set(draft.connectors.map((connector) => connector.name))
      const connector: Connector = {
        ...defaultScope(),
        id: stableId('conn', `http\0${url}`),
        name: uniqueName(serverName(entry.serverName), taken, 'claude'),
        title: titleOf(entry.serverName),
        transport: { type: 'http', url: entry.serverUrl },
        source: { kind: 'imported', fromHostKey: hostKey, fromHarness: 'claude' },
        auth: 'oauth',
        signIns: [],
        disabledTools: []
      }
      index = draft.connectors.push(connector) - 1
    }
    const connector = draft.connectors[index]
    if (!connector) {
      continue
    }
    const ref = signInRef(
      stableId('si', hostKey, key),
      `${connector.title} (from Claude Code on ${machine})`,
      'oauth',
      now
    )
    draft.connectors[index] = {
      ...connector,
      auth: connector.auth === 'none' ? 'oauth' : connector.auth,
      signIns: [...connector.signIns, ref]
    }
    draft.secrets.push({
      kind: 'oauth',
      id: ref.id,
      connectorId: connector.id,
      mcpOAuthKey: key,
      entry,
      updatedAt: now
    })
    known.add(key)
  }
}

async function waitForHostKey(service: SealConnectorsService): Promise<string | null> {
  for (let waited = 0; waited < HOST_KEY_WAIT_MS; waited += HOST_KEY_POLL_MS) {
    const key = service.hostKey()
    if (key) {
      return key
    }
    await new Promise((resolve) => setTimeout(resolve, HOST_KEY_POLL_MS))
  }
  return service.hostKey()
}

/**
 * Adopts what this host already has into the central list, once per host: its user-level MCP
 * servers (codegraph...) and, on Linux and Windows, Claude Code's existing MCP sign-ins.
 * Secrets go to the sealed store, never the list.
 */
export async function seedSealConnectors(
  service: SealConnectorsService,
  deps: SealSeedDeps
): Promise<void> {
  const hostKey = await waitForHostKey(service)
  if (!hostKey) {
    console.warn('[seal-connectors] This host has no id yet, so its MCP servers were not adopted.')
    return
  }
  const now = (deps.now ?? Date.now)()
  const config: SealConnectorsConfig = service.config()
  const draft: Draft = { connectors: [...config.connectors], secrets: [] }
  const firstRun = !config.importedHosts.includes(hostKey)
  if (firstRun) {
    for (const server of await findHostServers(deps)) {
      importServer(server, hostKey, draft, now)
    }
  }
  // Only on a host's first run: a later start must not bring back a sign-in someone removed.
  if (firstRun && process.platform !== 'darwin') {
    await adoptClaudeSignIns(service, deps, hostKey, draft, now)
  }
  if (!firstRun && draft.secrets.length === 0) {
    return
  }
  const failed = new Set<string>()
  for (const secret of draft.secrets) {
    try {
      service.saveSignIn(secret)
    } catch {
      failed.add(secret.id)
      console.warn('[seal-connectors] Could not store an adopted sign-in on this host.')
    }
  }
  // A connector whose secret could not be sealed stays out rather than listed without its sign-in.
  const drafted = draft.connectors.flatMap((connector) => {
    const signIns = connector.signIns.filter((ref) => !failed.has(ref.id))
    if (signIns.length === connector.signIns.length) {
      return [connector]
    }
    return config.connectors.some((own) => own.id === connector.id)
      ? [{ ...connector, signIns }]
      : []
  })
  const draftedById = new Map(drafted.map((connector) => [connector.id, connector]))
  service.editConfig((current) => {
    const own = new Set(current.connectors.map((connector) => connector.id))
    return {
      ...current,
      connectors: [
        ...current.connectors.map((connector) => {
          const next = draftedById.get(connector.id)
          return next
            ? {
                ...connector,
                auth: next.auth,
                signIns: [
                  ...connector.signIns,
                  ...next.signIns.filter((ref) => !connector.signIns.some((r) => r.id === ref.id))
                ]
              }
            : connector
        }),
        ...drafted.filter((connector) => !own.has(connector.id))
      ],
      importedHosts: current.importedHosts.includes(hostKey)
        ? current.importedHosts
        : [...current.importedHosts, hostKey]
    }
  })
}
