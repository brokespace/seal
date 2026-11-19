import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { getSealConnectorsHost } from './seal-connectors-host'
import type { RelayBinding } from './seal-connector-relay-keys'

const UPSTREAM_CONNECT_MS = 30_000
const EXPIRY_SKEW_MS = 5_000
const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'content-length',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id'
] as const

const RETURNED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'mcp-session-id',
  'mcp-protocol-version',
  'cache-control',
  'retry-after'
] as const

export function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {}
): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders })
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }))
}

export type Upstream =
  | { ok: true; url: URL; authorization: string | null; staticHeaders: Record<string, string> }
  | { ok: false; status: number; message: string }

function enabledSomewhere(item: {
  enabled: boolean
  projectOverrides: readonly { state: 'on' | 'off' }[]
}): boolean {
  return item.enabled || item.projectOverrides.some((override) => override.state === 'on')
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function resolveUpstream(binding: RelayBinding): Upstream {
  const host = getSealConnectorsHost()
  const connector = host?.config().connectors.find((entry) => entry.id === binding.connectorId)
  if (!host || !connector || connector.transport.type !== 'http') {
    return { ok: false, status: 404, message: 'This connector is no longer in Seal’s list.' }
  }
  // Off everywhere: no project override can still be switching it on for this session.
  if (!enabledSomewhere(connector)) {
    return { ok: false, status: 403, message: `${connector.title} is turned off in Seal.` }
  }
  const url = new URL(connector.transport.url)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, status: 404, message: `${connector.title} has no usable address.` }
  }
  if (binding.signInId === null) {
    return { ok: true, url, authorization: null, staticHeaders: {} }
  }
  const signIn = connector.signIns.find((entry) => entry.id === binding.signInId)
  if (!signIn) {
    return { ok: false, status: 404, message: `This sign-in was removed from ${connector.title}.` }
  }
  if (!enabledSomewhere(signIn)) {
    return { ok: false, status: 403, message: `This sign-in of ${connector.title} is turned off.` }
  }
  const secret = host.signIn(binding.signInId)
  if (!secret) {
    return {
      ok: false,
      status: 503,
      message: `${connector.title} is waiting for the refresher: this machine has no sign-in for it yet.`
    }
  }
  if (secret.kind === 'static') {
    return { ok: true, url, authorization: null, staticHeaders: secret.headers }
  }
  const { accessToken, expiresAt, serverUrl } = secret.entry
  if (originOf(serverUrl) !== url.origin) {
    return {
      ok: false,
      status: 409,
      message: `${connector.title} needs to be reconnected: the connector’s address changed.`
    }
  }
  if (host.needsReconnect(binding.signInId)) {
    return {
      ok: false,
      status: 401,
      message: `${connector.title} needs to be reconnected in Seal (its sign-in was refused).`
    }
  }
  if (
    !accessToken ||
    (typeof expiresAt === 'number' && expiresAt > 0 && expiresAt - EXPIRY_SKEW_MS < Date.now())
  ) {
    return {
      ok: false,
      status: 503,
      message: `${connector.title} is waiting for the refresher to renew its sign-in; try again shortly.`
    }
  }
  return { ok: true, url, authorization: `Bearer ${accessToken}`, staticHeaders: {} }
}

function upstreamHeaders(
  incoming: IncomingHttpHeaders,
  upstream: Extract<Upstream, { ok: true }>
): Record<string, string> {
  const headers: Record<string, string> = { 'accept-encoding': 'identity' }
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming[name]
    if (typeof value === 'string') {
      headers[name] = value
    }
  }
  Object.assign(headers, upstream.staticHeaders)
  if (upstream.authorization) {
    headers.authorization = upstream.authorization
  }
  return headers
}

export function proxy(
  req: IncomingMessage,
  res: ServerResponse,
  binding: RelayBinding,
  upstream: Extract<Upstream, { ok: true }>
): void {
  const title =
    getSealConnectorsHost()
      ?.config()
      .connectors.find((entry) => entry.id === binding.connectorId)?.title ?? binding.serverName
  const send = upstream.url.protocol === 'https:' ? httpsRequest : httpRequest
  const out = send(
    upstream.url,
    { method: req.method, headers: upstreamHeaders(req.headers, upstream) },
    (upstreamRes) => {
      clearTimeout(connectTimer)
      if (upstreamRes.statusCode === 401) {
        upstreamRes.resume()
        sendJsonRpcError(
          res,
          401,
          `${title} refused Seal’s sign-in. Reconnect it in Seal’s Connectors page.`
        )
        return
      }
      const headers: Record<string, string | string[]> = {}
      for (const name of RETURNED_RESPONSE_HEADERS) {
        const value = upstreamRes.headers[name]
        if (value !== undefined) {
          headers[name] = value
        }
      }
      res.writeHead(upstreamRes.statusCode ?? 502, headers)
      res.flushHeaders()
      upstreamRes.on('error', () => res.destroy())
      upstreamRes.pipe(res)
    }
  )
  const connectTimer = setTimeout(
    () => out.destroy(new Error('upstream connect timeout')),
    UPSTREAM_CONNECT_MS
  )
  out.on('error', () => {
    clearTimeout(connectTimer)
    sendJsonRpcError(res, 502, `${title} could not be reached from this machine.`)
  })
  res.on('close', () => {
    clearTimeout(connectTimer)
    if (!res.writableFinished) {
      out.destroy()
    }
  })
  req.on('error', () => out.destroy())
  req.pipe(out)
}
