import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import { withPluginRoot } from '../../shared/agent-plugins/agent-plugin-plan'
import {
  targetsInclude,
  targetsIncludeAccount
} from '../../shared/agent-plugins/agent-plugin-targets'
import type {
  AgentPluginLedger,
  AgentPluginRecord
} from '../../shared/agent-plugins/agent-plugin-types'
import { oauthAccountKey } from '../../shared/seal-accounts/seal-account-key'
import { writeFileAtomicallyIfUnchanged } from '../filesystem/atomic-file-publication'
import { readLocalAgentPluginLedger } from './agent-plugin-ledger-io'

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

function readObject(text: string | null): Record<string, unknown> | null {
  if (text === null) {
    return {}
  }
  try {
    const value: unknown = JSON.parse(text)
    return isPlainObject(value) ? value : null
  } catch {
    return null
  }
}

function child(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key]
  const next = isPlainObject(value) ? { ...value } : {}
  parent[key] = next
  return next
}

/** Writes only when something changed, never over a file that moved under us or a symlink. */
async function rewrite(
  path: string,
  edit: (value: Record<string, unknown>) => void
): Promise<void> {
  // A linked file is the user's own, like claude-profile-settings treats it.
  if ((await lstat(path).catch(() => null))?.isSymbolicLink()) {
    return
  }
  const text = await readText(path)
  const value = readObject(text)
  if (!value) {
    return
  }
  const next = structuredClone(value)
  edit(next)
  if (JSON.stringify(next) !== JSON.stringify(value)) {
    writeFileAtomicallyIfUnchanged(path, text, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600
    })
  }
}

type McpEntries = AgentPluginLedger['retiredMcpServers']

/** Each MCP entry Seal gives Claude Code for a plugin it translates there, as written. */
function claudeMcpCopies(record: AgentPluginRecord | undefined): McpEntries {
  if (!record?.agents.some((state) => state.agent === 'claude' && state.mode === 'translated')) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(record.provides.mcpServers).flatMap(([name, entry]) => {
      const ours = withPluginRoot(entry, record.root)
      return isPlainObject(ours) ? [[name, ours]] : []
    })
  )
}

/** Tombstones each Claude MCP copy `old` had that `next` drops; one `next` writes again is cleared. */
export function retireClaudeMcpCopies(
  retired: McpEntries,
  old: AgentPluginRecord | undefined,
  next: AgentPluginRecord | undefined
): McpEntries {
  const kept = claudeMcpCopies(next)
  const out = { ...retired }
  for (const [name, entry] of Object.entries(claudeMcpCopies(old))) {
    if (!isDeepStrictEqual(kept[name], entry)) {
      out[name] = entry
    }
  }
  for (const [name, entry] of Object.entries(kept)) {
    if (isDeepStrictEqual(out[name], entry)) {
      delete out[name]
    }
  }
  return out
}

/**
 * Re-applies each Agent plugin's account targets to one Claude account profile, after Seal's
 * setup has copied the default home's settings into it. That copy replaces `enabledPlugins`
 * whole whenever the default home changes it, so the account's own choice is written again on
 * every setup instead of being kept in the profile.
 */
export async function applyClaudeAccountPluginTargets(args: {
  userHome: string
  profileHome: string
  /** The profile's `.claude.json`. */
  stateFile: string
  /** The profile's login; undefined when it is not known yet. */
  email: string | undefined
}): Promise<void> {
  try {
    await applyTargets({
      ...args,
      accountKey: args.email ? oauthAccountKey('claude', args.email) : null
    })
  } catch (error) {
    console.warn('[agent-plugins] Could not apply account targets to a Claude profile:', error)
  }
}

async function applyTargets(args: {
  userHome: string
  profileHome: string
  stateFile: string
  accountKey: string | null
}): Promise<void> {
  const ledger = await readLocalAgentPluginLedger(args.userHome)
  if (!ledger) {
    return
  }
  const included = (plugin: AgentPluginLedger['plugins'][number]): boolean =>
    plugin.enabled &&
    targetsInclude(plugin.targets.agents, 'claude') &&
    (args.accountKey === null || targetsIncludeAccount(plugin.targets, args.accountKey))
  await rewrite(join(args.profileHome, 'settings.json'), (settings) => {
    for (const plugin of ledger.plugins) {
      const on = included(plugin)
      for (const listing of plugin.listings.filter((item) => item.harness === 'claude')) {
        child(settings, 'enabledPlugins')[listing.id] = on
      }
      const state = plugin.agents.find((item) => item.agent === 'claude')
      for (const skill of state?.mode === 'translated' ? state.skills : []) {
        if (skill.via) {
          continue
        }
        const overrides = child(settings, 'skillOverrides')
        if (on) {
          delete overrides[skill.name]
        } else {
          overrides[skill.name] = 'off'
        }
      }
    }
  })
  const copies = ledger.plugins.map((plugin) => ({ plugin, entries: claudeMcpCopies(plugin) }))
  if (
    copies.every(({ entries }) => Object.keys(entries).length === 0) &&
    Object.keys(ledger.retiredMcpServers).length === 0
  ) {
    return
  }
  await rewrite(args.stateFile, (state) => {
    const hadServers = isPlainObject(state.mcpServers)
    const servers = child(state, 'mcpServers')
    // Only Seal's own copy goes; a server of the account's own under that name stays.
    const dropOurs = (name: string, ours: Record<string, unknown>): void => {
      if (isDeepStrictEqual(servers[name], ours)) {
        delete servers[name]
      }
    }
    for (const [name, ours] of Object.entries(ledger.retiredMcpServers)) {
      dropOurs(name, ours)
    }
    for (const { plugin, entries } of copies) {
      for (const [name, ours] of Object.entries(entries)) {
        if (included(plugin)) {
          servers[name] ??= ours
        } else {
          dropOurs(name, ours)
        }
      }
    }
    if (!hadServers && Object.keys(servers).length === 0) {
      delete state.mcpServers
    }
  })
}
