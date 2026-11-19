import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import {
  targetsInclude,
  targetsIncludeAccount,
  targetsIncludeSystemAccount
} from '../../shared/agent-plugins/agent-plugin-targets'
import type { AgentPluginLedger } from '../../shared/agent-plugins/agent-plugin-types'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import type { SealAccountKey } from '../../shared/seal-accounts/seal-accounts-config'
import { getSystemCodexHomePath } from '../codex/configuration/homes/codex-home-paths'
import { getSealAccountManager } from '../seal-accounts/seal-account-manager'
import { readLocalAgentPluginLedger } from './agent-plugin-ledger-io'

/** Codex splits `-c` keys on every dot and keeps quotes literally, so such a name has no key. */
function configKey(...segments: string[]): string | null {
  return segments.some((segment) => /[.=]/.test(segment)) ? null : segments.join('.')
}

/**
 * `codex -c` overrides that give one Codex account its own plugin targets. Account homes mirror
 * `~/.codex/config.toml` and promote edits made in them back to it, so a per-account switch can
 * only live on the command line: native plugins switch on or off, and Seal's MCP copies switch off.
 * Codex refuses to start on an `mcp_servers` override for a server its config lacks, so only
 * `configuredServers` are switched.
 */
export function codexAccountPluginOverrides(
  ledger: AgentPluginLedger,
  accountKey: string,
  configuredServers: ReadonlySet<string>
): string[] {
  return ledger.plugins.flatMap((plugin) => {
    if (!plugin.enabled || !targetsInclude(plugin.targets.agents, 'codex')) {
      return []
    }
    const wanted = targetsIncludeAccount(plugin.targets, accountKey)
    if (wanted === targetsIncludeSystemAccount(plugin.targets, 'codex')) {
      return []
    }
    const native = plugin.listings
      .filter((listing) => listing.harness === 'codex')
      .map((listing) => configKey('plugins', listing.id, 'enabled'))
    const copies = wanted
      ? []
      : (plugin.agents.find((state) => state.agent === 'codex')?.mcpServers ?? [])
          .filter((server) => configuredServers.has(server.name))
          .map((server) => configKey('mcp_servers', server.name, 'enabled'))
    return [...native, ...copies].flatMap((key) => (key ? ['-c', `${key}=${wanted}`] : []))
  })
}

/** The saved account a Codex home belongs to: the account's own home, or a Seal session's copy. */
function codexHomeAccountKey(home: string): SealAccountKey | null {
  const manager = getSealAccountManager()
  if (!manager) {
    return null
  }
  const target = normalizeRuntimePathForComparison(home)
  const isHome = (path: string | null | undefined): boolean =>
    !!path && normalizeRuntimePathForComparison(path) === target
  const session = manager.store
    .getState()
    .sessions.find((entry) => entry.provider === 'codex' && isHome(entry.profileHome))
  if (session) {
    return session.accountKey
  }
  return (
    manager
      .baseCandidates('codex')
      .find((candidate) => candidate.localId && isHome(manager.codexHome(candidate.localId)))
      ?.key ?? null
  )
}

/** MCP server names in the `config.toml` a launch in `home` loads. */
async function configuredMcpServers(home: string | null): Promise<Set<string>> {
  const text = await readFile(join(home ?? getSystemCodexHomePath(), 'config.toml'), 'utf8').catch(
    () => ''
  )
  const parsed = parseTomlObject(text)
  const servers = parsed.ok ? parsed.value.mcp_servers : undefined
  return new Set(isPlainObject(servers) ? Object.keys(servers) : [])
}

/** Plugin overrides for a Codex launch on one saved account; a null home is `~/.codex`. */
export async function codexAccountPluginArgs(
  accountKey: SealAccountKey,
  home: string | null
): Promise<string[]> {
  try {
    const ledger = await readLocalAgentPluginLedger(homedir())
    return ledger
      ? codexAccountPluginOverrides(ledger, accountKey, await configuredMcpServers(home))
      : []
  } catch (error) {
    console.warn('[agent-plugins] Could not read account targets for a Codex launch:', error)
    return []
  }
}

/** Plugin overrides for a Codex launch in `home`; null is `~/.codex`, whose own config applies. */
export async function codexHomePluginArgs(home: string | null): Promise<string[]> {
  let accountKey: SealAccountKey | null = null
  try {
    accountKey = home ? codexHomeAccountKey(home) : null
  } catch (error) {
    console.warn('[agent-plugins] Could not tell which account a Codex launch runs on:', error)
  }
  return accountKey ? codexAccountPluginArgs(accountKey, home) : []
}
