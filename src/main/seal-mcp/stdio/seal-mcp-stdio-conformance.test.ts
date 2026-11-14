import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  connectSdkClientOverStdio,
  observeSealMcpConformance,
  READ_ONLY_CONFORMANCE,
  toolText
} from '../testing/seal-mcp-sdk-client.test-support'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

let outDir: string
let script: string
let client: Client | null = null

beforeAll(async () => {
  // Inside the repo so the bundle's package imports resolve from node_modules.
  outDir = await mkdtemp(join(REPO_ROOT, 'node_modules', '.seal-mcp-stdio-'))
  script = join(outDir, 'seal-mcp-stdio-host-process.cjs')
  await build({
    entryPoints: [fileURLToPath(new URL('./seal-mcp-stdio-host-process.ts', import.meta.url))],
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'silent'
  })
}, 60_000)

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true })
})

afterEach(async () => {
  await client?.close()
  client = null
})

function connect(env: Record<string, string> = {}): Promise<Client> {
  return connectSdkClientOverStdio(process.execPath, [script], {
    PATH: process.env.PATH ?? '',
    ...env
  })
}

describe('Seal MCP over stdio (`seal mcp`)', () => {
  it('passes the official SDK client through the handshake, tool list and tool calls', async () => {
    client = await connect()

    expect(await observeSealMcpConformance(client)).toEqual(READ_ONLY_CONFORMANCE)
  })

  it('offers a client only the tools its token is scoped for', async () => {
    client = await connect({ SEAL_MCP_FIXTURE_SCOPES: 'sessions' })

    const listed = await client.listTools()
    const refused = await client.callTool({ name: 'list_machines', arguments: {} })

    expect(listed.tools.map((tool) => tool.name)).toEqual(['message_session', 'start_session'])
    expect(refused.isError).toBe(true)
    expect(toolText(refused)).toContain('no tool')
  })

  it('refuses a revoked token at the handshake', async () => {
    await expect(connect({ SEAL_MCP_FIXTURE_TOKEN: 'revoked' })).rejects.toThrow(
      'not valid, or it was revoked'
    )
  })
})
