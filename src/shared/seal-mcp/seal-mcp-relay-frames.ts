// The tunnel between the Seal relay Worker and a Seal server: one WebSocket the server dials
// out, carrying the HTTP requests cloud MCP clients send to the relay. Imported by both sides, so
// it must stay free of Node and Worker APIs.

/** The server's outbound WebSocket, authenticated with its host session. */
export const SEAL_MCP_RELAY_HOST_PATH = '/v1/host/mcp'
/** Public endpoint: `/mcp/<relayHostId>`. */
export const SEAL_MCP_RELAY_PUBLIC_PREFIX = '/mcp/'
export const SEAL_MCP_RELAY_MAX_BODY_BYTES = 512 * 1024
/** Response bodies cross the tunnel in pieces, well under a WebSocket message limit. */
export const SEAL_MCP_RELAY_CHUNK_CHARS = 64 * 1024
export const SEAL_MCP_RELAY_PING = 'ping'
export const SEAL_MCP_RELAY_PONG = 'pong'

/** The only request headers the relay passes on; everything else stops at the edge. */
export const SEAL_MCP_RELAY_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-protocol-version',
  'origin'
] as const

/** The only response headers the relay returns to the caller. */
export const SEAL_MCP_RELAY_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'www-authenticate',
  'retry-after',
  'allow'
] as const

export type SealMcpRelayRequestFrame = {
  t: 'request'
  id: string
  method: string
  /** Lower-case names from SEAL_MCP_RELAY_REQUEST_HEADERS, plus `host` as the caller dialed it. */
  headers: Record<string, string>
  body: string
  /** The caller's address as the relay saw it. The server records it but cannot verify it. */
  remote: string | null
}

/** The caller went away; the server stops the work it was doing for it. */
export type SealMcpRelayAbortFrame = { t: 'abort'; id: string }

export type SealMcpRelayToHostFrame = SealMcpRelayRequestFrame | SealMcpRelayAbortFrame

export type SealMcpHostToRelayFrame =
  | { t: 'head'; id: string; status: number; headers: Record<string, string> }
  | { t: 'chunk'; id: string; data: string }
  | { t: 'end'; id: string }

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseRecord(text: string): Rec | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRec(parsed) ? parsed : null
  } catch {
    return null
  }
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const entries = Object.entries(value)
  return entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')
    ? Object.fromEntries(entries)
    : null
}

export function parseSealMcpRelayToHostFrame(text: string): SealMcpRelayToHostFrame | null {
  const frame = parseRecord(text)
  if (!frame || typeof frame.id !== 'string') {
    return null
  }
  if (frame.t === 'abort') {
    return { t: 'abort', id: frame.id }
  }
  const headers = stringRecord(frame.headers)
  if (
    frame.t !== 'request' ||
    typeof frame.method !== 'string' ||
    typeof frame.body !== 'string' ||
    !headers
  ) {
    return null
  }
  return {
    t: 'request',
    id: frame.id,
    method: frame.method,
    headers,
    body: frame.body,
    remote: typeof frame.remote === 'string' ? frame.remote : null
  }
}

export function parseSealMcpHostToRelayFrame(text: string): SealMcpHostToRelayFrame | null {
  const frame = parseRecord(text)
  if (!frame || typeof frame.id !== 'string') {
    return null
  }
  switch (frame.t) {
    case 'head': {
      const headers = stringRecord(frame.headers)
      return typeof frame.status === 'number' &&
        Number.isInteger(frame.status) &&
        frame.status >= 200 &&
        frame.status <= 599 &&
        headers
        ? { t: 'head', id: frame.id, status: frame.status, headers }
        : null
    }
    case 'chunk':
      return typeof frame.data === 'string' ? { t: 'chunk', id: frame.id, data: frame.data } : null
    case 'end':
      return { t: 'end', id: frame.id }
    default:
      return null
  }
}
