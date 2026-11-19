import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../filesystem/atomic-file-publication'
import { withClaudeConfigLocks } from '../seal-accounts/seal-claude-config-lock'
import {
  readClaudeHomeCredentials,
  writeClaudeHomeCredentials
} from '../seal-accounts/seal-claude-home-credentials'

/** One `mcpOAuth` value of Claude's credentials, keyed `<server>|<config hash>`. */
export type McpOAuthEntry = Record<string, unknown>
export type McpOAuthEntries = Record<string, McpOAuthEntry>

type HomeOptions = { system?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSignedIn(entry: unknown): entry is McpOAuthEntry {
  return isRecord(entry) && typeof entry.accessToken === 'string' && entry.accessToken !== ''
}

export function entryExpiry(entry: McpOAuthEntry): number {
  return typeof entry.expiresAt === 'number' ? entry.expiresAt : 0
}

export function parseCredentials(json: string | null): Record<string, unknown> | null {
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

export function mcpOAuthEntriesOf(credentials: Record<string, unknown>): McpOAuthEntries {
  return isRecord(credentials.mcpOAuth) ? (credentials.mcpOAuth as McpOAuthEntries) : {}
}

export function withEntries(
  credentials: Record<string, unknown>,
  entries: McpOAuthEntries
): Record<string, unknown> {
  const next = { ...credentials }
  if (Object.keys(entries).length > 0) {
    next.mcpOAuth = entries
  } else {
    delete next.mcpOAuth
  }
  return next
}

function sameEntries(before: unknown, after: McpOAuthEntries): boolean {
  return JSON.stringify(isRecord(before) ? before : {}) === JSON.stringify(after)
}

/**
 * Adds each signed-in incoming entry the current set lacks or holds an earlier expiry for. The
 * later expiry wins because servers such as Atlassian rotate refresh tokens.
 */
export function mergeLaterSignIns(
  current: McpOAuthEntries,
  incoming: McpOAuthEntries
): { entries: McpOAuthEntries; adopted: string[] } {
  const entries = { ...current }
  const adopted: string[] = []
  for (const [key, entry] of Object.entries(incoming)) {
    if (!isSignedIn(entry)) {
      continue
    }
    const own = current[key]
    if (!isSignedIn(own) || entryExpiry(entry) > entryExpiry(own)) {
      entries[key] = entry
      adopted.push(key)
    }
  }
  return { entries, adopted }
}

/** Claude skips a server it cached as needing sign-in, so drop the ones that now have one. */
export async function forgetNeedsAuth(home: string, servers: readonly string[]): Promise<void> {
  const file = join(home, 'mcp-needs-auth-cache.json')
  const cache = parseCredentials(await readFile(file, 'utf8').catch(() => null))
  if (!cache || !servers.some((name) => Object.hasOwn(cache, name))) {
    return
  }
  const next = Object.fromEntries(Object.entries(cache).filter(([name]) => !servers.includes(name)))
  writeFileAtomically(file, JSON.stringify(next), { mode: 0o600 })
}

/**
 * `source`'s Claude login carrying `target`'s own MCP sign-ins, so moving a login between homes
 * never overwrites (or brings along) server sign-ins. A target with no credentials leaves the
 * source as is.
 */
export function withLoginOnly(
  targetCredentialsJson: string | null,
  sourceCredentialsJson: string
): string {
  const source = parseCredentials(sourceCredentialsJson)
  const target = parseCredentials(targetCredentialsJson)
  if (!source || !target) {
    return sourceCredentialsJson
  }
  const own = mcpOAuthEntriesOf(target)
  return sameEntries(source.mcpOAuth, own)
    ? sourceCredentialsJson
    : JSON.stringify(withEntries(source, own))
}

export async function readMcpOAuthEntries(
  home: string,
  options: HomeOptions = {}
): Promise<McpOAuthEntries> {
  const credentials = parseCredentials(await readClaudeHomeCredentials(home, options))
  return credentials ? mcpOAuthEntriesOf(credentials) : {}
}

/**
 * Sets just these `mcpOAuth` keys in one home's credentials under Claude's locks, leaving the
 * login fields and other keys alone. A home with no login is skipped; returns whether it wrote.
 */
export async function writeMcpOAuthEntries(
  home: string,
  entries: McpOAuthEntries,
  options: HomeOptions = {}
): Promise<boolean> {
  // Taking Claude's locks creates lock folders, so skip homes with no login to write into.
  if ((await readClaudeHomeCredentials(home, options)) === null) {
    return false
  }
  return withClaudeConfigLocks([home], async () => {
    const credentials = parseCredentials(await readClaudeHomeCredentials(home, options))
    if (!credentials) {
      return false
    }
    const current = mcpOAuthEntriesOf(credentials)
    const next = { ...current, ...entries }
    if (sameEntries(current, next)) {
      return false
    }
    await writeClaudeHomeCredentials(home, JSON.stringify(withEntries(credentials, next)))
    await forgetNeedsAuth(
      home,
      Object.keys(entries).map((key) => key.split('|')[0] ?? key)
    )
    return true
  })
}
