import { randomUUID } from 'node:crypto'
import { serveSealMcpStdio } from '../../../cli/mcp/seal-mcp-commands'
import { isSealMcpScope } from '../../../shared/seal-mcp/seal-mcp-types'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { LOCAL_CLI_RPC_CALLER } from '../../runtime/rpc/callers/rpc-caller-identity'
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import { SEAL_MCP_METHODS } from '../../runtime/rpc/methods/mcp/seal-mcp-methods'
import { setSealMcpService } from '../seal-mcp-service-instance'
import { createSealMcpTestHost } from '../testing/seal-mcp-test-host.test-support'

/**
 * `seal mcp` as a process, for the stdio conformance test: the real command over the real
 * `sealMcp.message` RPC method and MCP service. Only the socket between the CLI and the Seal
 * server is replaced, by an in-process dispatcher acting as this machine's own CLI.
 */
async function main(): Promise<void> {
  const host = await createSealMcpTestHost()
  setSealMcpService(host.service)
  const scopes = (process.env.SEAL_MCP_FIXTURE_SCOPES ?? 'read').split(',').filter(isSealMcpScope)
  const { token, clientId } = host.createToken({ scopes })
  if (process.env.SEAL_MCP_FIXTURE_TOKEN === 'revoked') {
    host.service.revokeClient(clientId)
  }
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: sealMcp.* methods read the MCP service, never the runtime.
    runtime: { getRuntimeId: () => 'stdio-fixture' } as unknown as OrcaRuntimeService,
    methods: SEAL_MCP_METHODS
  })
  try {
    await serveSealMcpStdio(
      async (method, params) => {
        const response = await dispatcher.dispatch(
          { id: randomUUID(), authToken: 'fixture', method, params },
          { caller: LOCAL_CLI_RPC_CALLER }
        )
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: sealMcp.message returns SealMcpMessageResult.
        return { result: response.result as { reply: Record<string, unknown> | null } }
      },
      { SEAL_MCP_TOKEN: token }
    )
  } finally {
    await host.dispose()
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
)
