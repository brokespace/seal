import {
  acpConnectorServers,
  SEAL_CONNECTOR_KEY_ENV,
  type AcpMcpServer,
  type SessionConnectorPlan
} from '../../../shared/seal-connectors/session-connector-args'
import type { InitializeResponse } from '../generated/acp-protocol.generated'

/** The `mcpServers` of a session request: Seal's central connectors, as far as the agent supports them. */
export function acpLaunchMcpServers(
  connectors: SessionConnectorPlan | undefined,
  initialized: Pick<InitializeResponse, 'agentCapabilities'>
): AcpMcpServer[] {
  return connectors
    ? acpConnectorServers(connectors, connectors.env[SEAL_CONNECTOR_KEY_ENV] ?? null, {
        http: initialized.agentCapabilities?.mcpCapabilities?.http === true
      })
    : []
}
