import { useLocalSearchParams } from 'expo-router'
import { firstParam } from '../../../../src/navigation/route-param-reader'
import { McpApprovalsScreen } from '../../../../src/seal/mcp-approvals/McpApprovalsScreen'

export default function SealMcpApprovalsRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  return <McpApprovalsScreen key={hostId} hostId={hostId} />
}
