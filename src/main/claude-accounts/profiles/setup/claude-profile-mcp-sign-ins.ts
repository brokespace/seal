import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../../../filesystem/atomic-file-publication'
import { withClaudeConfigLocks } from '../../../seal-accounts/seal-claude-config-lock'
import {
  readClaudeHomeCredentials,
  writeClaudeHomeCredentials
} from '../../../seal-accounts/seal-claude-home-credentials'
import { readClaudeProfileObject } from '../claude-profile-paths'
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
 * default home's. The later expiry wins because servers such as Atlassian rotate refresh tokens,
 * and a key the default home signed out of since the last sync leaves the profile too.
 */
export function planMcpSignIns(args: {
  defaults: Entries
  profile: Entries
  synced: readonly string[]
  writeDefaults: boolean
}): McpSignInPlan {
  const profile = { ...args.profile }
  const defaults = { ...args.defaults }
  const adopted: string[] = []
  const signedOut = new Set(args.synced.filter((key) => !signedIn(args.defaults[key])))
  for (const key of signedOut) {
    if (signedIn(profile[key])) {
      delete profile[key]
    }
  }
  for (const key of new Set([...Object.keys(args.defaults), ...Object.keys(args.profile)])) {
    if (signedOut.has(key)) {
      continue
    }
    const fromDefaults = args.defaults[key]
    const own = args.profile[key]
    if (signedIn(fromDefaults) && (!signedIn(own) || expiry(fromDefaults) > expiry(own))) {
      profile[key] = fromDefaults
      adopted.push(key.split('|')[0] ?? key)
    } else if (
      args.writeDefaults &&
      signedIn(own) &&
      (!signedIn(fromDefaults) || expiry(own) > expiry(fromDefaults))
    ) {
      defaults[key] = own
    }
  }
  const synced = Object.keys(args.writeDefaults ? defaults : args.defaults).filter((key) =>
    signedIn((args.writeDefaults ? defaults : args.defaults)[key])
  )
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
function forgetNeedsAuth(profileHome: string, servers: readonly string[]): void {
  const file = join(profileHome, 'mcp-needs-auth-cache.json')
  const cache = readClaudeProfileObject(file)
  if (cache.kind !== 'present' || !servers.some((name) => Object.hasOwn(cache.value, name))) {
    return
  }
  const next = Object.fromEntries(
    Object.entries(cache.value).filter(([name]) => !servers.includes(name))
  )
  writeFileAtomically(file, JSON.stringify(next), { mode: 0o600 })
}

function readSynced(record: string): string[] {
  try {
    const value: unknown = JSON.parse(readFileSync(record, 'utf8'))
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
  // macOS keeps the default login in a keychain item Seal must not author; share one way there.
  const writeDefaults = args.platform !== 'darwin'
  // Taking Claude's locks creates lock folders, so skip homes with no login to share.
  if (
    (await readClaudeHomeCredentials(args.defaultHome, { system: args.systemDefault })) === null
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
    const plan = planMcpSignIns({
      defaults,
      profile,
      synced: readSynced(args.record),
      writeDefaults
    })
    let outcome: ClaudeProfileSurfaceOutcome = 'unchanged'
    if (changed(profile, plan.profile)) {
      await writeClaudeHomeCredentials(
        args.profileHome,
        JSON.stringify(withEntries(profileCredentials, plan.profile))
      )
      forgetNeedsAuth(args.profileHome, plan.adopted)
      outcome = 'merged'
    }
    if (writeDefaults && changed(defaults, plan.defaults)) {
      await writeClaudeHomeCredentials(
        args.defaultHome,
        JSON.stringify(withEntries(defaultCredentials, plan.defaults))
      )
      outcome = 'merged'
    }
    if (
      JSON.stringify(plan.synced.toSorted()) !== JSON.stringify(readSynced(args.record).toSorted())
    ) {
      writeFileAtomically(args.record, JSON.stringify(plan.synced), { mode: 0o600 })
    }
    return outcome
  })
}
