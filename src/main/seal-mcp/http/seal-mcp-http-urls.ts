import { networkInterfaces } from 'node:os'
import { SEAL_MCP_HTTP_PATH } from './seal-mcp-http-exchange'

const WILDCARD_HOSTS: ReadonlySet<string> = new Set(['0.0.0.0', '[::]', '::'])

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => address.address)
}

/**
 * The MCP URLs on this server's own port, from the runtime's `ws://host:port` endpoint. A server
 * listening on every interface is reachable at each LAN address; one on loopback only at loopback.
 */
export function sealMcpHttpUrls(webSocketEndpoint: string | null): string[] {
  if (!webSocketEndpoint) {
    return []
  }
  let url: URL
  try {
    url = new URL(webSocketEndpoint)
  } catch {
    return []
  }
  const hosts = WILDCARD_HOSTS.has(url.hostname) ? [...lanAddresses(), '127.0.0.1'] : [url.hostname]
  return hosts.map((host) => `http://${host}:${url.port}${SEAL_MCP_HTTP_PATH}`)
}
