import { useLocalSearchParams } from 'expo-router'
import { firstParam } from '../../../../src/navigation/route-param-reader'
import { SealAccountsScreen } from '../../../../src/seal/accounts/SealAccountsScreen'

export default function SealAccountsRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  return <SealAccountsScreen key={hostId} hostId={hostId} />
}
