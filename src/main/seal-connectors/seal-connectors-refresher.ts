import {
  discoverAuthorizationServerMetadata,
  refreshAuthorization
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  OAuthMetadataSchema,
  OpenIdProviderDiscoveryMetadataSchema,
  type AuthorizationServerMetadata
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { z } from 'zod'
import type { SignInSecret } from '../../shared/seal-connectors/seal-connectors-types'
import type { SealConnectorsService } from './seal-connectors-service'

const TICK_MS = 30_000
const REFRESH_AHEAD_MS = 15 * 60_000
// A longer gap between ticks means the machine slept, so the hub must confirm the lease again.
const MAX_TICK_GAP_MS = 2 * 60_000
const REQUEST_TIMEOUT_MS = 20_000
// Errors that mean the server will not accept this refresh token again.
const REFUSED_CODES = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client'])
const DEFAULT_LIFETIME_MS = 60 * 60_000

type OAuthSecret = Extract<SignInSecret, { kind: 'oauth' }>

export type SealConnectorsRefresher = {
  stop: () => void
  /** Refreshes every OAuth sign-in now when this host is the confirmed owner. */
  refreshNow: () => Promise<{ refreshed: string[]; skipped: string | null }>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

const DiscoveryStateSchema = z.object({
  authorizationServerUrl: z.string().optional(),
  authServerMetadataUrl: z.string().optional()
})

function discoveryField(
  entry: OAuthSecret['entry'],
  key: 'authorizationServerUrl' | 'authServerMetadataUrl'
): string | null {
  return text(DiscoveryStateSchema.safeParse(entry.discoveryState).data?.[key])
}

const fetchWithTimeout = (url: string | URL, init?: RequestInit): Promise<Response> =>
  fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

async function readMetadataDocument(url: string): Promise<AuthorizationServerMetadata | undefined> {
  const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    return undefined
  }
  const body: unknown = await response.json()
  const oauth = OAuthMetadataSchema.safeParse(body)
  if (oauth.success) {
    return oauth.data
  }
  const oidc = OpenIdProviderDiscoveryMetadataSchema.safeParse(body)
  return oidc.success ? oidc.data : undefined
}

async function authorizationServer(
  entry: OAuthSecret['entry']
): Promise<{ url: string; metadata: AuthorizationServerMetadata | undefined }> {
  const issuer = discoveryField(entry, 'authorizationServerUrl') ?? text(entry.issuer)
  const documentUrl = discoveryField(entry, 'authServerMetadataUrl')
  const metadata =
    (documentUrl ? await readMetadataDocument(documentUrl).catch(() => undefined) : undefined) ??
    (issuer
      ? await discoverAuthorizationServerMetadata(issuer, { fetchFn: fetchWithTimeout })
      : undefined)
  const url = issuer ?? text(metadata?.issuer) ?? new URL(entry.serverUrl).origin
  return { url, metadata }
}

/** The sign-in with its tokens renewed; the old refresh token stays when the server sends none. */
async function refreshedSecret(secret: OAuthSecret, now: number): Promise<OAuthSecret | null> {
  const { entry } = secret
  const clientId = text(entry.clientId)
  const refreshToken = text(entry.refreshToken)
  if (!clientId || !refreshToken) {
    return null
  }
  const server = await authorizationServer(entry)
  const tokens = await refreshAuthorization(server.url, {
    metadata: server.metadata,
    clientInformation: {
      client_id: clientId,
      ...(entry.clientSecret ? { client_secret: entry.clientSecret } : {})
    },
    refreshToken,
    resource: entry.serverUrl,
    fetchFn: fetchWithTimeout
  })
  return {
    ...secret,
    // Always after the copy it replaces, whatever this machine's clock says.
    updatedAt: Math.max(now, secret.updatedAt + 1),
    entry: {
      ...entry,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresAt: now + (tokens.expires_in ? tokens.expires_in * 1000 : DEFAULT_LIFETIME_MS),
      ...(tokens.scope ? { scope: tokens.scope } : {})
    }
  }
}

function dueForRefresh(secret: OAuthSecret, now: number, force: boolean): boolean {
  const expiresAt = secret.entry.expiresAt
  // A token with no expiry never lapses on its own, so there is nothing to renew ahead of time.
  return typeof expiresAt === 'number' && (force || expiresAt - now < REFRESH_AHEAD_MS)
}

/**
 * Only the lease owner the hub confirmed renews tokens, so a rotating refresh token is never
 * spent twice. Others use whatever the fleet pushes them.
 */
export function startSealConnectorsRefresher(
  service: SealConnectorsService,
  options: { now?: () => number; intervalMs?: number; onTick?: () => void } = {}
): SealConnectorsRefresher {
  const now = options.now ?? Date.now
  let lastTickAt: number | null = null
  let running: Promise<string[]> | null = null

  const refreshAll = async (force: boolean): Promise<string[]> => {
    const refreshed: string[] = []
    for (const connector of service.config().connectors) {
      for (const ref of connector.signIns) {
        const secret = service.signIn(ref.id)
        // The lease can lapse mid-pass; a host that lost it must not spend another token.
        if (!service.mayRefresh()) {
          return refreshed
        }
        if (secret?.kind !== 'oauth' || !dueForRefresh(secret, now(), force)) {
          continue
        }
        try {
          const next = await refreshedSecret(secret, now())
          if (!next) {
            service.markNeedsReconnect(ref.id, true)
            continue
          }
          service.saveSignIn(next)
          refreshed.push(ref.id)
        } catch (error) {
          if (error instanceof OAuthError && REFUSED_CODES.has(error.errorCode)) {
            service.markNeedsReconnect(ref.id, true)
          }
          // Only the error's class is logged: server replies and tokens stay out of logs.
          console.warn(
            `[seal-connectors] Could not refresh a sign-in (${error instanceof Error ? error.name : 'error'}).`
          )
        }
      }
    }
    return refreshed
  }

  const attempt = (force: boolean): Promise<string[]> => {
    running ??= refreshAll(force).finally(() => {
      running = null
    })
    return running
  }

  const tick = (): void => {
    const at = now()
    if (lastTickAt !== null && at - lastTickAt > MAX_TICK_GAP_MS) {
      service.lease.clearConfirmation()
    }
    lastTickAt = at
    options.onTick?.()
    if (!service.mayRefresh()) {
      return
    }
    service.lease.stampHeartbeat()
    void attempt(false)
  }

  const timer = setInterval(tick, options.intervalMs ?? TICK_MS)
  timer.unref?.()
  return {
    stop: () => clearInterval(timer),
    refreshNow: async () => {
      if (!service.mayRefresh()) {
        return { refreshed: [], skipped: 'This machine is not the confirmed refresher.' }
      }
      return { refreshed: await attempt(true), skipped: null }
    }
  }
}
