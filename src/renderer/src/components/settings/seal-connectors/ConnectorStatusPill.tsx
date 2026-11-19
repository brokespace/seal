import {
  IntegrationStatusPill,
  type IntegrationStatusTone
} from '@/components/integration-status-pill'
import { useTranslate } from '@/i18n/use-translate'
import type { ConnectorSignInState, SignInState } from './seal-connector-status'

type PillState = ConnectorSignInState | SignInState

const TONES: Record<PillState, IntegrationStatusTone> = {
  connected: 'connected',
  'no-sign-in-needed': 'neutral',
  'not-on-this-machine': 'neutral',
  'needs-sign-in': 'attention',
  'waiting-for-refresh': 'attention',
  'needs-reconnect': 'attention',
  missing: 'attention',
  expired: 'attention',
  stale: 'attention'
}

export function useConnectorStatusLabel(): (state: PillState) => string {
  const t = useTranslate()
  return (state) => {
    switch (state) {
      case 'connected':
        return t('seal.connectors.status.connected', 'Connected')
      case 'needs-sign-in':
        return t('seal.connectors.status.needsSignIn', 'Needs sign-in')
      case 'waiting-for-refresh':
        return t('seal.connectors.status.waitingForRefresh', 'Waiting for refresh')
      case 'expired':
        return t('seal.connectors.status.expired', 'Expired')
      case 'needs-reconnect':
        return t('seal.connectors.status.needsReconnect', 'Needs reconnect')
      case 'not-on-this-machine':
        return t('seal.connectors.status.notHere', 'Not on this machine')
      case 'missing':
        return t('seal.connectors.status.missing', 'Missing')
      case 'stale':
        return t('seal.connectors.status.stale', 'Stale')
      case 'no-sign-in-needed':
        return t('seal.connectors.status.noSignIn', 'No sign-in needed')
    }
  }
}

export function ConnectorStatusPill({ state }: { state: PillState }): React.JSX.Element {
  const label = useConnectorStatusLabel()
  return (
    <span data-connector-status={state}>
      <IntegrationStatusPill tone={TONES[state]}>{label(state)}</IntegrationStatusPill>
    </span>
  )
}
