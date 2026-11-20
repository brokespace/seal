import type { SealProjectIdentity } from '../../shared/seal-accounts/seal-account-policy'
import { SEAL_ACCOUNT_KEY_ENV } from '../../shared/seal-accounts/seal-launch-env'
import {
  scopeIncludes,
  type ScopeContext
} from '../../shared/seal-connectors/seal-connectors-scope'
import {
  SEAL_CONNECTOR_KEY_ENV,
  type PlannedServer,
  type SessionConnectorPlan
} from '../../shared/seal-connectors/session-connector-args'
import type { Connector, SignInRef } from '../../shared/seal-connectors/seal-connectors-types'
import { getSealAccountManager } from '../seal-accounts/seal-account-manager'
import { sealChatAssignment } from '../seal-accounts/seal-chat-launch'
import { sealProjectIdentity } from '../seal-accounts/seal-launch-pick-context'
import {
  mintSessionKey,
  rebindSessionKeys,
  relayUrl,
  startSealConnectorRelay,
  type RelayBinding
} from './seal-connector-relay'
import { getSealConnectorsHost, type SealConnectorsHost } from './seal-connectors-host'
import { connectorKey } from './seal-connectors-host-servers'

export type SessionConnectorInput = {
  sessionId: string
  /** Launchable agent id (`claude`, `codex`, `grok`...). */
  harness: string
  accountKey: string | null
  project: SealProjectIdentity | null
  /** False for a line typed into a pane whose shell already holds the session's key. */
  mintKey?: boolean
}

/** A host that never finishes loading must not hold a launch; the agent then keeps its own config. */
const READY_TIMEOUT_MS = 5_000

async function hostWhenReady(): Promise<SealConnectorsHost | null> {
  const host = getSealConnectorsHost()
  if (!host) {
    return null
  }
  let timer: NodeJS.Timeout | undefined
  const ready = await Promise.race([
    host.ready().then(
      () => true,
      () => false
    ),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS)
      timer.unref()
    })
  ])
  clearTimeout(timer)
  return ready ? host : null
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

function envSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

type ServerSeed = { connector: Connector; signIn: SignInRef | null; name: string }

function serverSeeds(host: SealConnectorsHost, ctx: ScopeContext): ServerSeed[] {
  const seeds: ServerSeed[] = []
  const taken = new Set<string>()
  // A host may list one server at user level and again for a project.
  const unsignedTransports = new Set<string>()
  const claim = (wanted: string): string => {
    let name = wanted.slice(0, 64)
    for (let n = 2; taken.has(name); n += 1) {
      name = `${wanted.slice(0, 60)}-${n}`
    }
    taken.add(name)
    return name
  }
  for (const connector of host.config().connectors) {
    if (!scopeIncludes(connector, ctx)) {
      continue
    }
    if (connector.auth === 'none') {
      const duplicate = `${connector.auth}\0${connectorKey(connector)}`
      if (!unsignedTransports.has(duplicate)) {
        unsignedTransports.add(duplicate)
        seeds.push({ connector, signIn: null, name: claim(connector.name) })
      }
      continue
    }
    const signIns = connector.signIns.filter(
      (signIn) => scopeIncludes(signIn, ctx) && host.signIn(signIn.id) !== null
    )
    for (const signIn of signIns) {
      const suffix = slug(signIn.label)
      seeds.push({
        connector,
        signIn,
        name: claim(
          signIns.length === 1 || !suffix ? connector.name : `${connector.name}_${suffix}`
        )
      })
    }
  }
  return seeds
}

function plannedServer(
  host: SealConnectorsHost,
  seed: ServerSeed,
  env: Record<string, string>,
  bindings: RelayBinding[]
): PlannedServer | null {
  const { connector, signIn, name } = seed
  const disabledTools = connector.disabledTools
  const { transport } = connector
  if (transport.type === 'stdio') {
    const secretEnv: Record<string, string> = {}
    const secret = signIn ? host.signIn(signIn.id) : null
    if (secret?.kind === 'static') {
      for (const [variable, value] of Object.entries(secret.env)) {
        if (ENV_NAME.test(variable)) {
          const sessionVar = `SEAL_CONNECTOR_${envSegment(name)}_${envSegment(variable)}`
          env[sessionVar] = value
          secretEnv[variable] = sessionVar
        }
      }
    }
    // Plugin servers name files inside their plugin, as Claude Code's own loader expands them.
    const root =
      connector.source.kind === 'plugin' ? host.pluginDir(connector.source.pluginId) : null
    const expand = (value: string): string =>
      root ? value.replaceAll('${CLAUDE_PLUGIN_ROOT}', root) : value
    return {
      name,
      type: 'stdio',
      command: expand(transport.command),
      args: transport.args.map(expand),
      env: Object.fromEntries(
        Object.entries(transport.env).map(([key, value]) => [key, expand(value)])
      ),
      secretEnv,
      disabledTools
    }
  }
  if (connector.auth === 'none') {
    return { name, type: 'http', url: transport.url, relay: false, disabledTools }
  }
  const url = relayUrl(name)
  if (!url) {
    return null
  }
  bindings.push({ serverName: name, connectorId: connector.id, signInId: signIn?.id ?? null })
  return { name, type: 'http', url, relay: true, disabledTools }
}

function pluginDirs(host: SealConnectorsHost, ctx: ScopeContext): string[] {
  const dirs: string[] = []
  for (const plugin of host.config().plugins) {
    // Codex plugins have no folder a Claude-style loader reads.
    if (plugin.harness !== 'claude' || !scopeIncludes(plugin, ctx)) {
      continue
    }
    const dir = host.pluginDir(plugin.id)
    if (dir) {
      dirs.push(dir)
    }
  }
  const skills = host
    .config()
    .skills.some((skill) => skill.source.kind === 'library' && scopeIncludes(skill, ctx))
  const skillsDir = skills ? host.librarySkillsDir() : null
  return skillsDir ? [...dirs, skillsDir] : dirs
}

/** A failure here must never break a launch: the agent then keeps its own configuration. */
async function planOrNull(
  resolve: () => Promise<SessionConnectorPlan | null>
): Promise<SessionConnectorPlan | null> {
  try {
    return await resolve()
  } catch (error) {
    console.warn(
      '[seal-connectors] Could not resolve a session’s connectors:',
      error instanceof Error ? error.name : 'Error'
    )
    return null
  }
}

/**
 * What Seal's central list gives one session. Null when this host has no loaded list or the
 * lookup fails: launch code then changes nothing, so an agent keeps working from its own
 * configuration.
 */
export function resolveSessionConnectors(
  input: SessionConnectorInput
): Promise<SessionConnectorPlan | null> {
  return planOrNull(() => resolvePlan(input))
}

async function resolvePlan(input: SessionConnectorInput): Promise<SessionConnectorPlan | null> {
  const host = await hostWhenReady()
  const hostKey = host?.hostKey()
  // Strict mode would cut off this host's own servers (codegraph) until they were adopted.
  if (!host || !hostKey || !host.config().importedHosts.includes(hostKey)) {
    return null
  }
  const ctx: ScopeContext = {
    machineKeys: host.machineKeys(),
    accountKey: input.accountKey,
    harness: input.harness,
    project: input.project
  }
  const seeds = serverSeeds(host, ctx)
  if (
    seeds.some((seed) => seed.connector.transport.type === 'http' && seed.connector.auth !== 'none')
  ) {
    await startSealConnectorRelay().catch((error: unknown) => {
      console.warn(
        '[seal-connectors] The relay did not start:',
        error instanceof Error ? error.name : error
      )
    })
  }
  const env: Record<string, string> = {}
  const bindings: RelayBinding[] = []
  const servers = seeds.flatMap((seed) => plannedServer(host, seed, env, bindings) ?? [])
  if (bindings.length > 0) {
    if (input.mintKey === false) {
      rebindSessionKeys(input.sessionId, bindings)
    } else {
      env[SEAL_CONNECTOR_KEY_ENV] = mintSessionKey(input.sessionId, bindings)
    }
  }
  return {
    env,
    servers,
    pluginDirs: pluginDirs(host, ctx),
    disallowedTools: servers.flatMap((server) =>
      server.disabledTools.map((tool) => `mcp__${server.name}__${tool}`)
    )
  }
}

/** A terminal launch: the account Seal routed it to travels in its env. */
export function resolveTerminalConnectors(input: {
  sessionId: string
  harness: string
  env: Readonly<Record<string, string | undefined>> | undefined
  worktreeId: string | undefined
}): Promise<SessionConnectorPlan | null> {
  return planOrNull(() => {
    const manager = getSealAccountManager()
    return resolvePlan({
      sessionId: input.sessionId,
      harness: input.harness,
      accountKey: input.env?.[SEAL_ACCOUNT_KEY_ENV] || null,
      project: manager ? sealProjectIdentity(manager, input.worktreeId) : null
    })
  })
}

/** A chat launch: the account Seal picked for the chat is on its assignment. */
export function resolveChatConnectors(
  record: { sessionId: string; location: { workspaceId?: string | null } },
  harness: string
): Promise<SessionConnectorPlan | null> {
  return planOrNull(() => {
    const manager = getSealAccountManager()
    return resolvePlan({
      sessionId: record.sessionId,
      harness,
      accountKey: manager
        ? (sealChatAssignment(manager, record.sessionId)?.accountKey ?? null)
        : null,
      project: manager
        ? sealProjectIdentity(manager, record.location.workspaceId || undefined)
        : null
    })
  })
}
