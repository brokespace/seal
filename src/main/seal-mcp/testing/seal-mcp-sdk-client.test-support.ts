import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const CLIENT_INFO = { name: 'seal-conformance', version: '1.0.0' }

/** The official SDK client over Streamable HTTP, signed in with a Seal client token. */
export async function connectSdkClientOverHttp(url: string, token: string): Promise<Client> {
  const client = new Client(CLIENT_INFO)
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    })
  )
  return client
}

/** The official SDK client talking to a spawned process over stdio. */
export async function connectSdkClientOverStdio(
  command: string,
  args: string[],
  env: Record<string, string>
): Promise<Client> {
  const client = new Client(CLIENT_INFO)
  await client.connect(new StdioClientTransport({ command, args, env, stderr: 'pipe' }))
  return client
}

export function toolText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = Array.isArray(result.content) ? result.content : []
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('')
}

export type SealMcpConformanceReport = {
  serverName: string | undefined
  capabilities: unknown
  instructionsMentionFirstTool: boolean
  ping: unknown
  tools: string[]
  everyToolHasObjectSchemaAndDescription: boolean
  listMachines: { isError: unknown; mentionsGpu: boolean }
  invalidArgumentsIsError: unknown
  unknownMethodCode: unknown
}

/**
 * What every transport must get right, as the official SDK client sees it: the handshake, a tool
 * list that passes the SDK's schema checks, a tool call, a tool-level error and a protocol-level
 * error. Returned as data so suites on different test runners can assert on it.
 */
export async function observeSealMcpConformance(client: Client): Promise<SealMcpConformanceReport> {
  const listed = await client.listTools()
  const machines = await client.callTool({ name: 'list_machines', arguments: {} })
  const invalid = await client.callTool({ name: 'list_workspaces', arguments: { limit: 'many' } })
  const unknownMethod: unknown = await client.listResources().then(
    () => null,
    (error: unknown) => error
  )
  return {
    serverName: client.getServerVersion()?.name,
    capabilities: client.getServerCapabilities(),
    instructionsMentionFirstTool: client.getInstructions()?.includes('list_machines') === true,
    ping: await client.ping(),
    tools: listed.tools.map((tool) => tool.name),
    everyToolHasObjectSchemaAndDescription: listed.tools.every(
      (tool) => tool.inputSchema.type === 'object' && Boolean(tool.description)
    ),
    listMachines: { isError: machines.isError, mentionsGpu: toolText(machines).includes('gpu') },
    invalidArgumentsIsError: invalid.isError,
    unknownMethodCode:
      typeof unknownMethod === 'object' && unknownMethod !== null && 'code' in unknownMethod
        ? unknownMethod.code
        : null
  }
}

/** The report a read-only client must produce on every transport. */
export const READ_ONLY_CONFORMANCE: SealMcpConformanceReport = {
  serverName: 'seal',
  capabilities: { tools: {} },
  instructionsMentionFirstTool: true,
  ping: {},
  tools: [
    'list_machines',
    'list_sessions',
    'read_session',
    'account_usage',
    'list_skills',
    'load_skill',
    'list_projects',
    'list_workspaces'
  ],
  everyToolHasObjectSchemaAndDescription: true,
  listMachines: { isError: false, mentionsGpu: true },
  invalidArgumentsIsError: true,
  unknownMethodCode: -32601
}
