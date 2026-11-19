import { homedir } from 'node:os'
import {
  targetsInclude,
  targetsIncludeAccount,
  targetsIncludeSystemAccount
} from '../../shared/agent-plugins/agent-plugin-targets'
import type { AgentPluginLedger } from '../../shared/agent-plugins/agent-plugin-types'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import type { SealAccountKey } from '../../shared/seal-accounts/seal-accounts-config'
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
 */
export function codexAccountPluginOverrides(
  ledger: AgentPluginLedger,
  accountKey: string
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
      : (plugin.agents.find((state) => state.agent === 'codex')?.mcpServers ?? []).map((server) =>
          configKey('mcp_servers', server.name, 'enabled')
        )
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

/** Plugin overrides for a Codex launch on one saved account. */
export async function codexAccountPluginArgs(accountKey: SealAccountKey): Promise<string[]> {
  try {
    const ledger = await readLocalAgentPluginLedger(homedir())
    return ledger ? codexAccountPluginOverrides(ledger, accountKey) : []
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
  return accountKey ? codexAccountPluginArgs(accountKey) : []
}
