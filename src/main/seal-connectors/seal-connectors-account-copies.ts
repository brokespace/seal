import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  McpOAuthEntrySchema,
  type SignInSecret
} from '../../shared/seal-connectors/seal-connectors-types'
import { listClaudeProfileHomesAsync } from '../claude-accounts/profiles/claude-profile-homes'
import { sealPinnedPointerPath } from '../seal-accounts/seal-claude-launch-pin'
import type { SealAccountManager } from '../seal-accounts/seal-account-manager'
import {
  entryExpiry,
  isSignedIn,
  readMcpOAuthEntries,
  writeMcpOAuthEntries,
  type McpOAuthEntries
} from './claude-mcp-oauth-entries'
import type { SealConnectorsService } from './seal-connectors-service'

const DEBOUNCE_MS = 1_000

type OAuthSecret = Extract<SignInSecret, { kind: 'oauth' }>

type HomesManager = Pick<SealAccountManager, 'dataRoot' | 'services' | 'store'>

async function pinnedHomes(dataRoot: string): Promise<string[]> {
  const pins = await readdir(dirname(sealPinnedPointerPath(dataRoot, 'any'))).catch(() => [])
  const homes = await Promise.all(
    pins.map(async (pin) => {
      const home = (
        await readFile(sealPinnedPointerPath(dataRoot, pin), 'utf8').catch(() => '')
      ).trim()
      return home && (await stat(home).catch(() => null))?.isDirectory() ? home : null
    })
  )
  return homes.filter((home) => home !== null)
}

/** Every Claude config dir on this host: the default one, accounts, pinned launches and session homes. */
export async function sealClaudeHomes(
  manager: HomesManager,
  defaultHome: string
): Promise<string[]> {
  const sessions = manager.store
    .getState()
    .sessions.flatMap((session) =>
      session.provider === 'claude' && session.profileHome ? [session.profileHome] : []
    )
  const homes = [
    defaultHome,
    ...manager.services.claudeRuntimeAuth.router.accountHomes(),
    ...(await listClaudeProfileHomesAsync(join(manager.dataRoot, 'seal-sessions', 'claude'))),
    ...sessions,
    ...(await pinnedHomes(manager.dataRoot))
  ]
  return [...new Set(homes)]
}

/**
 * One sign-in per Claude key: a home holds a single `mcpOAuth` value per server, so a second
 * account for the same service (listed later) reaches sessions through the relay only.
 */
function oauthSecrets(service: SealConnectorsService): OAuthSecret[] {
  const ids = new Set(
    service.config().connectors.flatMap((connector) => connector.signIns.map((ref) => ref.id))
  )
  const byKey = new Map<string, OAuthSecret>()
  for (const id of ids) {
    const secret = service.signIn(id)
    if (secret?.kind === 'oauth' && !byKey.has(secret.mcpOAuthKey)) {
      byKey.set(secret.mcpOAuthKey, secret)
    }
  }
  return [...byKey.values()]
}

/**
 * One pass over every home. A home holding a later token for a sign-in Seal knows (a Claude run
 * refreshed it) becomes the new stored version; then each home that lags behind the store gets
 * just that `mcpOAuth` key written, never its login.
 */
export async function copySealSignInsToHomes(
  service: SealConnectorsService,
  homes: readonly string[],
  now: () => number = Date.now
): Promise<void> {
  const held = new Map<string, McpOAuthEntries>()
  for (const home of homes) {
    held.set(home, await readMcpOAuthEntries(home))
  }
  // Only the refresher adopts, so versions of one sign-in come from one machine at a time.
  const adopting = service.mayRefresh()
  for (const secret of adopting ? oauthSecrets(service) : []) {
    let newest = secret
    for (const entries of held.values()) {
      const entry = entries[secret.mcpOAuthKey]
      if (
        isSignedIn(entry) &&
        entryExpiry(entry) > entryExpiry(newest.entry) &&
        entry.accessToken !== newest.entry.accessToken
      ) {
        const adopted = McpOAuthEntrySchema.safeParse({ ...secret.entry, ...entry })
        if (adopted.success) {
          newest = {
            ...secret,
            entry: adopted.data,
            updatedAt: Math.max(now(), newest.updatedAt + 1)
          }
        }
      }
    }
    if (newest !== secret) {
      service.saveSignIn(newest)
    }
  }
  const current = oauthSecrets(service).filter((secret) => isSignedIn(secret.entry))
  for (const [home, entries] of held) {
    const wanted: McpOAuthEntries = {}
    for (const secret of current) {
      const own = entries[secret.mcpOAuthKey]
      if (!isSignedIn(own) || entryExpiry(secret.entry) > entryExpiry(own)) {
        // No refresh token: a Claude run there must not spend the rotating token Seal renews.
        const { refreshToken: _kept, ...copy } = secret.entry
        wanted[secret.mcpOAuthKey] = copy
      }
    }
    if (Object.keys(wanted).length > 0) {
      await writeMcpOAuthEntries(home, wanted)
    }
  }
}

export type SealConnectorsAccountCopies = {
  stop: () => void
  /** Runs one pass now; the refresher's tick calls it to catch tokens a Claude run refreshed. */
  pass: () => Promise<void>
}

/**
 * Keeps every Claude config dir on this host holding the newest MCP sign-ins (Linux and Windows;
 * on macOS those items share the keychain entry of the Claude login, which Seal never touches).
 */
export function startSealConnectorsAccountCopies(
  service: SealConnectorsService,
  deps: { homes: () => Promise<string[]>; now?: () => number }
): SealConnectorsAccountCopies {
  if (process.platform === 'darwin') {
    return { stop: () => {}, pass: async () => {} }
  }
  let running = false
  let again = false
  const pass = async (): Promise<void> => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await copySealSignInsToHomes(service, await deps.homes(), deps.now)
    } catch (error) {
      console.warn(
        '[seal-connectors] Could not copy sign-ins to Claude accounts:',
        error instanceof Error ? error.message : ''
      )
    } finally {
      running = false
      if (again) {
        again = false
        void pass()
      }
    }
  }
  let debounce: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = service.onChange(() => {
    clearTimeout(debounce ?? undefined)
    debounce = setTimeout(() => void pass(), DEBOUNCE_MS)
    debounce.unref?.()
  })
  void service.ready().then(pass)
  return {
    pass,
    stop: () => {
      unsubscribe()
      clearTimeout(debounce ?? undefined)
    }
  }
}
