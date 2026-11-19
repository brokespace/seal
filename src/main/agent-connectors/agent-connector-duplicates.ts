import type {
  AgentConnector,
  AgentConnectorDuplicateGroup,
  AgentConnectorKeepReason
} from '../../shared/agent-connectors/agent-connector-types'

// Hosts that front many services, so sharing one says nothing about the service.
const SHARED_HOSTS = new Set(['claude.ai', 'anthropic.com', 'localhost', '127.0.0.1', '[::1]'])
const STATUS_RANK = { connected: 0, 'needs-auth': 1, configured: 2, failed: 3, disabled: 4 }
const KIND_RANK = { 'claude-ai': 0, plugin: 1, user: 2, project: 3 }
const COPY_SUFFIX = /\s*\(\d+\)$/

/** `claude.ai Atlassian (2)`, `Atlassian MCP` and `plugin:atlassian:atlassian` all name `atlassian`. */
export function connectorBaseName(name: string): string {
  const plain = name.startsWith('plugin:')
    ? (name.split(':').at(-1) ?? name)
    : name.replace(/^claude\.ai\s+/, '')
  return plain
    .replace(COPY_SUFFIX, '')
    .replace(/[\s_-]*mcp(?:[\s_-]*server)?$/i, '')
    .replace(/^mcp[\s_-]+/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** The site's registrable part (`mcp.atlassian.com` → `atlassian.com`); null for stdio or shared hosts. */
export function connectorServiceHost(connector: AgentConnector): string | null {
  if (connector.transport !== 'http' && connector.transport !== 'sse') {
    return null
  }
  try {
    const host = new URL(connector.target).hostname.toLowerCase()
    const site = host.split('.').slice(-2).join('.')
    return SHARED_HOSTS.has(host) || SHARED_HOSTS.has(site) ? null : site
  } catch {
    return null
  }
}

function keepOf(group: AgentConnector[]): {
  keep: AgentConnector
  reason: AgentConnectorKeepReason
} {
  const [keep, runnerUp] = group.toSorted(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      Number(COPY_SUFFIX.test(a.name)) - Number(COPY_SUFFIX.test(b.name)) ||
      a.name.length - b.name.length
  )
  const reason: AgentConnectorKeepReason =
    keep.status === 'connected' && runnerUp.status !== 'connected'
      ? 'connected'
      : keep.kind === 'claude-ai' && runnerUp.kind !== 'claude-ai'
        ? 'claude-ai'
        : 'original'
  return { keep, reason }
}

/** Groups connectors that share a base name or a service host; each group keeps one suggestion. */
export function findConnectorDuplicates(
  connectors: readonly AgentConnector[]
): AgentConnectorDuplicateGroup[] {
  const parent = connectors.map((_, index) => index)
  const root = (index: number): number =>
    parent[index] === index ? index : (parent[index] = root(parent[index]))
  const firstByKey = new Map<string, number>()
  connectors.forEach((connector, index) => {
    const base = connectorBaseName(connector.name)
    const host = connectorServiceHost(connector)
    for (const key of [base ? `name:${base}` : null, host ? `host:${host}` : null]) {
      if (!key) {
        continue
      }
      const first = firstByKey.get(key)
      if (first === undefined) {
        firstByKey.set(key, index)
      } else {
        parent[root(index)] = root(first)
      }
    }
  })
  const groups = new Map<number, AgentConnector[]>()
  connectors.forEach((connector, index) => {
    const key = root(index)
    groups.set(key, [...(groups.get(key) ?? []), connector])
  })
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const { keep, reason } = keepOf(group)
      return {
        service: connectorServiceHost(keep) ?? connectorBaseName(keep.name),
        names: group.map((connector) => connector.name),
        keep: keep.name,
        reason
      }
    })
}
