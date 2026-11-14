import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  HOME_CHAT_TOOLS,
  homeChatToolJsonSchema,
  type HomeChatToolName
} from '../../tools/home-chat-tool-definitions'
import { answerMcpRequest, isMcpRecord } from '../../../seal-mcp/protocol/mcp-json-rpc-server'

export const SEAL_MCP_TOKEN_ENV = 'SEAL_HOME_CHAT_MCP_TOKEN'
const MAX_BODY_BYTES = 8 * 1024 * 1024

export type SealMcpToolAnswer = { text: string; isError: boolean }

export type SealMcpEndpoint = {
  url: string
  /** Handed to the CLI through its environment, never its arguments. */
  token: string
  close: () => Promise<void>
}

const isRec = isMcpRecord

const MCP_SERVER_INFO = { name: 'seal', version: '1.0.0' }

function toolList(): unknown[] {
  return Object.entries(HOME_CHAT_TOOLS).map(([name, spec]) => ({
    name,
    description: spec.description,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: name is a key of HOME_CHAT_TOOLS.
    inputSchema: homeChatToolJsonSchema(name as HomeChatToolName)
  }))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function authorized(req: IncomingMessage, token: string): boolean {
  const given = Buffer.from(req.headers.authorization ?? '')
  const wanted = Buffer.from(`Bearer ${token}`)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

/**
 * Seal's tools as an MCP server over HTTP on loopback, for one turn of a CLI that cannot host them
 * in-process. Only a caller holding the turn's token gets in.
 */
export async function openSealMcpEndpoint(
  callTool: (name: string, args: unknown) => Promise<SealMcpToolAnswer>
): Promise<SealMcpEndpoint> {
  const token = randomBytes(32).toString('hex')
  const server = createServer((req, res) => {
    void (async () => {
      if (!authorized(req, token)) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      if (req.method !== 'POST') {
        // No server-initiated stream; the spec lets a server decline GET this way.
        send(res, req.method === 'DELETE' ? 200 : 405)
        return
      }
      const parsed: unknown = JSON.parse(await readBody(req))
      const requests = Array.isArray(parsed) ? parsed.filter(isRec) : isRec(parsed) ? [parsed] : []
      const replies = (
        await Promise.all(
          requests.map((request) =>
            answerMcpRequest(request, {
              serverInfo: MCP_SERVER_INFO,
              listTools: toolList,
              callTool
            })
          )
        )
      ).filter((reply) => reply !== null)
      if (replies.length === 0) {
        send(res, 202)
        return
      }
      send(res, 200, Array.isArray(parsed) ? replies : replies[0])
    })().catch(() => {
      if (!res.headersSent) {
        send(res, 400, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        })
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a TCP listener's address is an AddressInfo.
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}
