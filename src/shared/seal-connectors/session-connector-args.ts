/** The env var that carries a session's relay key; renderers only ever write its name. */
export const SEAL_CONNECTOR_KEY_ENV = 'SEAL_CONNECTOR_KEY'

export type PlannedServer =
  | {
      name: string
      type: 'http'
      /** The relay URL when `relay`, else the connector's own (no sign-in needed). */
      url: string
      /** Reached through the host's relay with the session key; the relay adds the sign-in. */
      relay: boolean
      /** Bare tool names the user turned off for this connector. */
      disabledTools: string[]
    }
  | {
      name: string
      type: 'stdio'
      command: string
      args: string[]
      /** Non-secret values. */
      env: Record<string, string>
      /** Variable the server reads -> session env var that holds its secret value. */
      secretEnv: Record<string, string>
      disabledTools: string[]
    }

/** What one session gets from Seal's central list; secrets are only ever in `env`. */
export type SessionConnectorPlan = {
  env: Record<string, string>
  servers: PlannedServer[]
  pluginDirs: string[]
  /** `mcp__<server>__<tool>`. */
  disallowedTools: string[]
}

const KEY_PLACEHOLDER = `\${${SEAL_CONNECTOR_KEY_ENV}}`

function placeholder(name: string): string {
  return `\${${name}}`
}

type ClaudeMcpServer =
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }

function claudeMcpServers(
  plan: SessionConnectorPlan,
  keyReference: string
): Record<string, ClaudeMcpServer> {
  const servers: Record<string, ClaudeMcpServer> = {}
  for (const server of plan.servers) {
    if (server.type === 'http') {
      servers[server.name] = server.relay
        ? {
            type: 'http',
            url: server.url,
            headers: { Authorization: `Bearer ${keyReference}` }
          }
        : { type: 'http', url: server.url }
      continue
    }
    const env = {
      ...server.env,
      ...Object.fromEntries(
        Object.entries(server.secretEnv).map(([variable, sessionVar]) => [
          variable,
          placeholder(sessionVar)
        ])
      )
    }
    servers[server.name] = {
      type: 'stdio',
      command: server.command,
      args: server.args,
      ...(Object.keys(env).length > 0 ? { env } : {})
    }
  }
  return servers
}

/**
 * Args for a terminal `claude`, inserted right after the executable. The disallowed list is
 * variadic, so it stays before a flag that ends it.
 */
export function claudeConnectorArgs(
  plan: SessionConnectorPlan,
  options: {
    tolerateMissingKey?: boolean
    /** Turns the config JSON into the `--mcp-config` argument (a file path keeps it out of shell quoting). */
    mcpConfigArgument?: (json: string) => string
  } = {}
): string[] {
  const keyReference = options.tolerateMissingKey
    ? `\${${SEAL_CONNECTOR_KEY_ENV}:-}`
    : KEY_PLACEHOLDER
  return [
    ...(plan.servers.length > 0
      ? [
          '--mcp-config',
          (options.mcpConfigArgument ?? ((json) => json))(
            JSON.stringify({ mcpServers: claudeMcpServers(plan, keyReference) })
          )
        ]
      : []),
    ...(plan.disallowedTools.length > 0
      ? ['--disallowedTools', plan.disallowedTools.join(',')]
      : []),
    '--strict-mcp-config',
    ...plan.pluginDirs.flatMap((dir) => ['--plugin-dir', dir])
  ]
}

export type ClaudeSdkConnectorOptions = {
  mcpServers: Record<string, ClaudeMcpServer>
  strictMcpConfig: true
  plugins: { type: 'local'; path: string; skipMcpDiscovery: true }[]
  disallowedTools: string[]
}

/** The SDK takes the same config as options; the key reaches the child only through its env. */
export function claudeSdkConnectorOptions(plan: SessionConnectorPlan): ClaudeSdkConnectorOptions {
  return {
    mcpServers: claudeMcpServers(plan, KEY_PLACEHOLDER),
    strictMcpConfig: true,
    plugins: plan.pluginDirs.map((path) => ({ type: 'local', path, skipMcpDiscovery: true })),
    disallowedTools: plan.disallowedTools
  }
}

/** Codex splits `-c` paths on dots, so a quoted key with a dot cannot be addressed. */
const BARE_TOML_KEY = /^[A-Za-z0-9_-]+$/

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlStrings(values: readonly string[]): string {
  return `[${values.map(tomlString).join(',')}]`
}

function hasSecretEnv(server: Extract<PlannedServer, { type: 'stdio' }>): boolean {
  return Object.keys(server.secretEnv).length > 0
}

/** Codex forwards named env vars to a stdio server but cannot rename them, so a shell renames. */
function codexStdioCommand(server: Extract<PlannedServer, { type: 'stdio' }>): {
  command: string
  args: string[]
} {
  const renames = Object.entries(server.secretEnv)
  if (renames.length === 0) {
    return { command: server.command, args: server.args }
  }
  const assignments = renames
    .map(([variable, sessionVar]) => `${variable}="\${${sessionVar}}"`)
    .join(' ')
  return {
    command: 'sh',
    args: ['-c', `${assignments} exec "$@"`, 'sh', server.command, ...server.args]
  }
}

let warnedWindowsSecretServers = false

/**
 * `-c` overrides for codex: every server of the account's config.toml the plan leaves out is
 * turned off, then each planned server is spelled out in full (an override of a server config.toml
 * lacks needs a url or command). Windows has no `sh` for the secret-renaming wrapper, so those
 * servers are left out there.
 */
export function codexConnectorArgs(
  plan: SessionConnectorPlan,
  configServerNames: readonly string[],
  platform: NodeJS.Platform = process.platform
): string[] {
  const override = (name: string, field: string, value: string): string[] => [
    '-c',
    `mcp_servers.${name}.${field}=${value}`
  ]
  const servers = plan.servers.filter(
    (server) => !(platform === 'win32' && server.type === 'stdio' && hasSecretEnv(server))
  )
  if (servers.length < plan.servers.length && !warnedWindowsSecretServers) {
    warnedWindowsSecretServers = true
    console.warn('[seal-connectors] Codex on Windows gets no stdio servers that need secrets.')
  }
  const planned = new Set(servers.map((server) => server.name))
  const args: string[] = []
  for (const name of configServerNames) {
    if (!planned.has(name) && BARE_TOML_KEY.test(name)) {
      args.push(...override(name, 'enabled', 'false'))
    }
  }
  for (const server of servers) {
    if (server.type === 'http') {
      args.push(...override(server.name, 'url', tomlString(server.url)))
      if (server.relay) {
        args.push(
          ...override(server.name, 'bearer_token_env_var', tomlString(SEAL_CONNECTOR_KEY_ENV))
        )
      }
    } else {
      const { command, args: commandArgs } = codexStdioCommand(server)
      args.push(...override(server.name, 'command', tomlString(command)))
      args.push(...override(server.name, 'args', tomlStrings(commandArgs)))
      for (const [variable, value] of Object.entries(server.env)) {
        if (BARE_TOML_KEY.test(variable)) {
          args.push(...override(server.name, `env.${variable}`, tomlString(value)))
        }
      }
      const forwarded = Object.values(server.secretEnv)
      if (forwarded.length > 0) {
        args.push(...override(server.name, 'env_vars', tomlStrings(forwarded)))
      }
    }
    args.push(...override(server.name, 'enabled', 'true'))
    if (server.disabledTools.length > 0) {
      args.push(...override(server.name, 'disabled_tools', tomlStrings(server.disabledTools)))
    }
  }
  return args
}

export type AcpMcpServer =
  | { type: 'http'; name: string; url: string; headers: { name: string; value: string }[] }
  | {
      name: string
      command: string
      args: string[]
      env: { name: string; value: string }[]
    }

/**
 * ACP `mcpServers` for session/new and session/load. The key travels in a header over the agent's
 * stdio; servers it cannot reach over http are left out.
 */
export function acpConnectorServers(
  plan: SessionConnectorPlan,
  key: string | null,
  caps: { http: boolean }
): AcpMcpServer[] {
  const servers: AcpMcpServer[] = []
  for (const server of plan.servers) {
    if (server.type === 'http') {
      if (!caps.http || (server.relay && key === null)) {
        continue
      }
      servers.push({
        type: 'http',
        name: server.name,
        url: server.url,
        headers: server.relay ? [{ name: 'Authorization', value: `Bearer ${key}` }] : []
      })
      continue
    }
    servers.push({
      name: server.name,
      command: server.command,
      args: server.args,
      env: [
        ...Object.entries(server.env).map(([name, value]) => ({ name, value })),
        ...Object.entries(server.secretEnv).flatMap(([name, sessionVar]) => {
          const value = plan.env[sessionVar]
          return value === undefined ? [] : [{ name, value }]
        })
      ]
    })
  }
  return servers
}
