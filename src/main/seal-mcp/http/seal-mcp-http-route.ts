import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { getSealMcpService } from '../seal-mcp-service-instance'
import {
  answerSealMcpHttp,
  SEAL_MCP_HTTP_PATH,
  SEAL_MCP_MAX_BODY_BYTES,
  type SealMcpHttpExchange
} from './seal-mcp-http-exchange'

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > SEAL_MCP_MAX_BODY_BYTES) {
        // Stop buffering but let the request finish, so the caller reads the 413.
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () =>
      resolve(size > SEAL_MCP_MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8'))
    )
    request.on('error', reject)
  })
}

function singleHeaders(request: IncomingMessage): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value[0] : value
    ])
  )
}

function exchangeFor(request: IncomingMessage, response: ServerResponse): SealMcpHttpExchange {
  const gone = new AbortController()
  response.on('close', () => {
    if (!response.writableFinished) {
      gone.abort()
    }
  })
  return {
    method: request.method ?? 'GET',
    headers: singleHeaders(request),
    readBody: () => readBody(request),
    peer: { transport: 'http', remote: request.socket.remoteAddress ?? null },
    signal: gone.signal,
    respond: (status, headers, body) => {
      response.writeHead(status, headers)
      response.end(body)
    },
    openStream: (status, headers) => {
      response.writeHead(status, headers)
      response.flushHeaders()
      return {
        write: (chunk) => {
          if (!response.writableEnded) {
            response.write(chunk)
          }
        },
        end: () => response.end()
      }
    }
  }
}

function isMcpPath(url: string | undefined): boolean {
  return url === SEAL_MCP_HTTP_PATH || url?.startsWith(`${SEAL_MCP_HTTP_PATH}?`) === true
}

/**
 * Puts the MCP endpoint on the runtime's own HTTP listener, so LAN clients reach it on the port
 * paired devices already use. Every other path goes to `fallback`.
 */
export function withSealMcpRoute(fallback: RequestListener): RequestListener {
  return (request, response) => {
    const service = getSealMcpService()
    if (!service || !isMcpPath(request.url)) {
      fallback(request, response)
      return
    }
    answerSealMcpHttp(service, exchangeFor(request, response)).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500)
      }
      response.end()
    })
  }
}
