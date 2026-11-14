import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setSealMcpService } from '../seal-mcp-service-instance'
import {
  connectSdkClientOverHttp,
  observeSealMcpConformance,
  READ_ONLY_CONFORMANCE,
  toolText
} from '../testing/seal-mcp-sdk-client.test-support'
import {
  createSealMcpTestHost,
  type SealMcpTestHost
} from '../testing/seal-mcp-test-host.test-support'
import { withSealMcpRoute } from './seal-mcp-http-route'

let host: SealMcpTestHost
let server: Server
let url: string
let client: Client | null

beforeEach(async () => {
  host = await createSealMcpTestHost({ approvalTimeoutMs: 2_000 })
  host.service.updateSettings({ httpEnabled: true })
  setSealMcpService(host.service)
  server = createServer(
    withSealMcpRoute((_request, response) => {
      response.writeHead(404)
      response.end('not mcp')
    })
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a TCP listener's address is an AddressInfo.
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
  client = null
})

afterEach(async () => {
  await client?.close()
  setSealMcpService(null)
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await host.dispose()
})

function post(
  token: string | null,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: JSON.stringify(body)
  })
}

const LIST_TOOLS = { jsonrpc: '2.0', id: 1, method: 'tools/list' }

describe('Seal MCP over Streamable HTTP', () => {
  it('passes the official SDK client through the handshake, tool list and tool calls', async () => {
    client = await connectSdkClientOverHttp(url, host.createToken().token)

    expect(await observeSealMcpConformance(client)).toEqual(READ_ONLY_CONFORMANCE)
    expect(host.service.listAudit({ limit: 1 })[0]).toMatchObject({
      transport: 'http',
      remote: expect.stringContaining('127.0.0.1')
    })
  })

  it('streams a tool call that waits on approval, and returns its result once approved', async () => {
    client = await connectSdkClientOverHttp(
      url,
      host.createToken({ scopes: ['sessions', 'destructive'] }).token
    )
    host.service.onEvent((event) => {
      if (event.type === 'approval-requested') {
        setTimeout(() => host.service.respondApproval(event.request.id, true), 50)
      }
    })

    const stopped = await client.callTool({
      name: 'stop_session',
      arguments: { session_id: 's-local' }
    })

    expect(stopped.isError).toBe(false)
    expect(toolText(stopped)).toContain('Stopped s-local')
  })

  it('answers 401 with a Bearer challenge to a missing, unknown or revoked token', async () => {
    const { token, clientId } = host.createToken()

    const missing = await post(null, LIST_TOOLS)
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="seal-mcp"')
    expect(
      (await post('smcp_000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', LIST_TOOLS))
        .status
    ).toBe(401)

    expect((await post(token, LIST_TOOLS)).status).toBe(200)
    host.service.revokeClient(clientId)
    expect((await post(token, LIST_TOOLS)).status).toBe(401)
  })

  it('rejects an SDK client whose token is not valid', async () => {
    await expect(connectSdkClientOverHttp(url, 'smcp_wrong')).rejects.toThrow()
  })

  it('is not there at all until HTTP access is switched on', async () => {
    const { token } = host.createToken()
    host.service.updateSettings({ httpEnabled: false })

    expect((await post(token, LIST_TOOLS)).status).toBe(404)
  })

  it('refuses a browser page on another origin even when it holds a token', async () => {
    const { token } = host.createToken()

    const reply = await post(token, LIST_TOOLS, { origin: 'https://evil.example' })

    expect(reply.status).toBe(403)
  })

  it('declines GET, accepts notifications with 202 and rejects a body that is not JSON-RPC', async () => {
    const { token } = host.createToken()
    const authorization = { authorization: `Bearer ${token}` }

    expect((await fetch(url, { headers: authorization })).status).toBe(405)
    expect(
      (await post(token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status
    ).toBe(202)
    const garbage = await fetch(url, {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: '{not json'
    })
    expect(garbage.status).toBe(400)
    expect(await garbage.json()).toMatchObject({ error: { code: -32700 } })
  })

  it('leaves every other path to the server it shares a port with', async () => {
    const other = await fetch(url.replace('/mcp', '/web-index.html'))

    expect(other.status).toBe(404)
    expect(await other.text()).toBe('not mcp')
  })
})
