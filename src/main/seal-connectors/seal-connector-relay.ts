import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  openSessionKey,
  releaseRelayKeys,
  relayKeys,
  saveRelayKeys,
  type RelayKeys
} from './seal-connector-relay-keys'
import { proxy, resolveUpstream, sendJsonRpcError } from './seal-connector-relay-upstream'

export { mintSessionKey, rebindSessionKeys, type RelayBinding } from './seal-connector-relay-keys'

const SERVER_ROUTE = /^\/c\/([a-z0-9][a-z0-9_-]{0,63})\/?$/

type RelayState = {
  keys: RelayKeys
  server: Server | null
  starting: Promise<{ port: number }> | null
}

let state: RelayState | null = null

function current(dir?: string): RelayState {
  state ??= { keys: relayKeys(dir), server: null, starting: null }
  return state
}

export function sealConnectorRelayPort(): number | null {
  return state?.server ? state.keys.port : null
}

/** The URL a session's MCP client uses for one planned server; null until the relay listens. */
export function relayUrl(serverName: string): string | null {
  const port = sealConnectorRelayPort()
  return port === null ? null : `http://127.0.0.1:${port}/c/${serverName}`
}

function bearerKey(header: string | undefined): string | null {
  const match = /^Bearer (\S+)$/.exec(header ?? '')
  return match ? match[1] : null
}

function isLoopbackPeer(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1'
}

function handle(keys: RelayKeys, port: number, req: IncomingMessage, res: ServerResponse): void {
  if (
    !isLoopbackPeer(req.socket.remoteAddress) ||
    req.headers.origin !== undefined ||
    req.headers.host !== `127.0.0.1:${port}`
  ) {
    sendJsonRpcError(res, 403, 'Forbidden')
    return
  }
  const route = SERVER_ROUTE.exec((req.url ?? '').split('?')[0])
  if (!route) {
    sendJsonRpcError(res, 404, 'Not found')
    return
  }
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
    sendJsonRpcError(res, 405, 'Method not allowed', { allow: 'POST, GET, DELETE' })
    return
  }
  const key = bearerKey(req.headers.authorization)
  const record = key ? openSessionKey(keys, key) : null
  if (!record) {
    sendJsonRpcError(res, 401, 'Unauthorized')
    return
  }
  const binding = record.bindings.find((entry) => entry.serverName === route[1])
  if (!binding) {
    sendJsonRpcError(res, 404, 'This session has no such connector.')
    return
  }
  const upstream = resolveUpstream(binding)
  if (!upstream.ok) {
    req.resume()
    sendJsonRpcError(
      res,
      upstream.status,
      upstream.message,
      upstream.status === 503 ? { 'retry-after': '30' } : {}
    )
    return
  }
  proxy(req, res, binding, upstream)
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a TCP listener's address is an AddressInfo.
      resolve((server.address() as AddressInfo).port)
    })
  })
}

async function start(relay: RelayState): Promise<{ port: number }> {
  const { keys } = relay
  const server = createServer((req, res) => {
    if (keys.port === null) {
      sendJsonRpcError(res, 503, 'Starting')
      return
    }
    handle(keys, keys.port, req, res)
  })
  let port: number
  try {
    // Sessions that outlive a restart still hold the old port in their config.
    port = await listen(server, keys.port ?? 0)
  } catch (error) {
    if (keys.port === null) {
      throw error
    }
    port = await listen(server, 0)
  }
  const changed = keys.port !== port
  keys.port = port
  relay.server = server
  if (changed) {
    saveRelayKeys(keys)
  }
  return { port }
}

/** Starts this host's relay once; later calls return the same port. */
export function startSealConnectorRelay(
  options: { dataDir?: string } = {}
): Promise<{ port: number }> {
  const relay = current(options.dataDir)
  if (relay.server && relay.keys.port !== null) {
    return Promise.resolve({ port: relay.keys.port })
  }
  relay.starting ??= start(relay).catch((error) => {
    relay.starting = null
    throw error
  })
  return relay.starting
}

export async function stopSealConnectorRelay(): Promise<void> {
  const relay = state
  state = null
  if (!relay) {
    return
  }
  releaseRelayKeys()
  const server =
    relay.server ??
    (relay.starting
      ? await relay.starting.then(
          () => relay.server,
          () => null
        )
      : null)
  if (!server) {
    return
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}
