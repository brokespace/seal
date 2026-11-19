import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../../../filesystem/atomic-file-publication'
import { withClaudeConfigLocks } from '../../../seal-accounts/seal-claude-config-lock'
import {
  readClaudeHomeCredentials,
  writeClaudeHomeCredentials
} from '../../../seal-accounts/seal-claude-home-credentials'
import type { ClaudeProfileSurfaceOutcome } from '../claude-profile-report'
import { ClaudeProfileSurfaceError } from '../claude-profile-report'

type Entries = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function signedIn(entry: unknown): entry is Record<string, unknown> {
  return isRecord(entry) && typeof entry.accessToken === 'string' && entry.accessToken !== ''
}

function expiry(entry: Record<string, unknown>): number {
  return typeof entry.expiresAt === 'number' ? entry.expiresAt : 0
}

export type McpSignInPlan = {
  profile: Entries
  defaults: Entries
  /** Keys the default home holds a sign-in for, recorded so a later sign-out there reaches the profile. */
  synced: string[]
  /** Server names whose sign-in the profile just received. */
  adopted: string[]
}

/**
 * Converges one profile's MCP OAuth sign-ins (`mcpOAuth`, keyed `<server>|<config hash>`) with the
 * default home's, which decides which servers are signed in. The later expiry wins because servers
 * such as Atlassian rotate refresh tokens, and a key the default home signed out of since the last
 * sync leaves the profile too. A profile only writes back a refresh of a sign-in the default home
 * still holds, so a sign-out there cannot come back.
 */
export function planMcpSignIns(args: {
  defaults: Entries
  profile: Entries
  synced: readonly string[]
}): McpSignInPlan {
  const profile = { ...args.profile }
  const defaults = { ...args.defaults }
  const adopted: string[] = []
  for (const key of args.synced) {
    if (!signedIn(args.defaults[key]) && signedIn(profile[key])) {
      delete profile[key]
    }
  }
  for (const [key, fromDefaults] of Object.entries(args.defaults)) {
    if (!signedIn(fromDefaults)) {
      continue
    }
    const own = args.profile[key]
    if (!signedIn(own) || expiry(fromDefaults) > expiry(own)) {
      profile[key] = fromDefaults
      adopted.push(key.split('|')[0] ?? key)
    } else if (expiry(own) > expiry(fromDefaults)) {
      defaults[key] = own
    }
  }
  const synced = Object.keys(defaults).filter((key) => signedIn(defaults[key]))
  return { profile, defaults, synced, adopted }
}

function parseCredentials(json: string | null): Record<string, unknown> | null {
  if (json === null) {
    return null
  }
  try {
    const value: unknown = JSON.parse(json)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function withEntries(
  credentials: Record<string, unknown>,
  entries: Entries
): Record<string, unknown> {
  const next = { ...credentials }
  if (Object.keys(entries).length > 0) {
    next.mcpOAuth = entries
  } else {
    delete next.mcpOAuth
  }
  return next
}

function changed(before: unknown, after: Entries): boolean {
  return JSON.stringify(isRecord(before) ? before : {}) !== JSON.stringify(after)
}

/** Claude skips a server it cached as needing sign-in, so drop the ones that now have one. */
async function forgetNeedsAuth(profileHome: string, servers: readonly string[]): Promise<void> {
  const file = join(profileHome, 'mcp-needs-auth-cache.json')
  const cache = parseCredentials(await readFile(file, 'utf8').catch(() => null))
  if (!cache || !servers.some((name) => Object.hasOwn(cache, name))) {
    return
  }
  const next = Object.fromEntries(Object.entries(cache).filter(([name]) => !servers.includes(name)))
  writeFileAtomically(file, JSON.stringify(next), { mode: 0o600 })
}

async function readSynced(record: string): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await readFile(record, 'utf8'))
    return Array.isArray(value) ? value.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}

/**
 * Shares MCP server sign-ins (OAuth for HTTP/SSE servers, including plugin servers like Slack and
 * Atlassian) between the default home and an account profile, so a server connected once works
 * under every account. claude.ai connectors are not here: claude.ai holds those per account.
 */
export async function shareClaudeMcpSignIns(args: {
  defaultHome: string
  profileHome: string
  /** Default home is the System default login (no CLAUDE_CONFIG_DIR), as the macOS keychain names it. */
  systemDefault: boolean
  record: string
  platform: NodeJS.Platform
}): Promise<ClaudeProfileSurfaceOutcome> {
  // macOS keeps these in keychain items too large for `security -i` to rewrite safely, and a
  // one-way copy there would let a profile's refresh retire the default home's rotating token.
  if (args.platform === 'darwin') {
    return 'absent'
  }
  // Taking Claude's locks creates lock folders, so skip homes with no login to share.
  if (
    (await readClaudeHomeCredentials(args.defaultHome, { system: args.systemDefault })) === null ||
    (await readClaudeHomeCredentials(args.profileHome)) === null
  ) {
    return 'absent'
  }
  return withClaudeConfigLocks([args.defaultHome, args.profileHome], async () => {
    const defaultCredentials = parseCredentials(
      await readClaudeHomeCredentials(args.defaultHome, { system: args.systemDefault })
    )
    if (!defaultCredentials) {
      return 'absent'
    }
    const profileJson = await readClaudeHomeCredentials(args.profileHome)
    const profileCredentials = parseCredentials(profileJson)
    if (profileJson !== null && !profileCredentials) {
      throw new ClaudeProfileSurfaceError('unreadable', 'Profile Claude credentials are unreadable')
    }
    // Without a login the profile is not usable yet; its sign-in will bring a credentials file.
    if (!profileCredentials) {
      return 'absent'
    }
    const defaults = isRecord(defaultCredentials.mcpOAuth) ? defaultCredentials.mcpOAuth : {}
    const profile = isRecord(profileCredentials.mcpOAuth) ? profileCredentials.mcpOAuth : {}
    const synced = await readSynced(args.record)
    const plan = planMcpSignIns({ defaults, profile, synced })
    let outcome: ClaudeProfileSurfaceOutcome = 'unchanged'
    if (changed(profile, plan.profile)) {
      await writeClaudeHomeCredentials(
        args.profileHome,
        JSON.stringify(withEntries(profileCredentials, plan.profile))
      )
      await forgetNeedsAuth(args.profileHome, plan.adopted)
      outcome = 'merged'
    }
    if (changed(defaults, plan.defaults)) {
      await writeClaudeHomeCredentials(
        args.defaultHome,
        JSON.stringify(withEntries(defaultCredentials, plan.defaults))
      )
      outcome = 'merged'
    }
    if (JSON.stringify(plan.synced.toSorted()) !== JSON.stringify(synced.toSorted())) {
      writeFileAtomically(args.record, JSON.stringify(plan.synced), { mode: 0o600 })
    }
    return outcome
  })
}

/**
 * `login` carrying `copy`'s own MCP sign-ins, so copying an account login between homes leaves
 * each home's server sign-ins to the sharing above instead of overwriting them.
 */
export function keepMcpSignIns(login: string, copy: string | null): string {
  const into = parseCredentials(login)
  const from = parseCredentials(copy)
  if (!into || !from) {
    return login
  }
  const own = isRecord(from.mcpOAuth) ? from.mcpOAuth : {}
  return changed(into.mcpOAuth, own) ? JSON.stringify(withEntries(into, own)) : login
}
