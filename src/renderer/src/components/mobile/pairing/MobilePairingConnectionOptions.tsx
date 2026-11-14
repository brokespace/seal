import { useEffect, useRef, useState } from 'react'
import { Badge } from '../../ui/badge'
import { translate } from '../../../i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MobileRelayStatus,
  MobileRelayStatusDetail
} from '../../../../../shared/remote-runtime/relay/mobile-relay-status'
import type { MobilePairingConnectionMode } from '../../../../../shared/remote-runtime/pairing/mobile-pairing-connection-mode'
import { MobilePairingPathOption } from './MobilePairingPathOption'
import { relayClockSkewMessage } from '../relay-clock-skew-message'

function relayStatusLabel(status: MobileRelayStatus, t: Translate = translate): string {
  if (status === 'registered') {
    return t('auto.components.settings.MobilePairingConnectionOptions.ready', 'Ready')
  }
  if (status === 'connecting') {
    return t('auto.components.settings.MobilePairingConnectionOptions.connecting', 'Connecting')
  }
  if (status === 'standby') {
    return t('auto.components.settings.MobilePairingConnectionOptions.available', 'Available')
  }
  if (status === 'draining') {
    return t('auto.components.settings.MobilePairingConnectionOptions.reconnecting', 'Reconnecting')
  }
  return t('auto.components.settings.MobilePairingConnectionOptions.unavailable', 'Unavailable')
}

// Show the landed Relay cell for support; the scheme offers no actionable detail.
function relayCellLabel(cellUrl: string): string | null {
  try {
    return new URL(cellUrl).host || null
  } catch {
    return null
  }
}

export function MobilePairingConnectionOptions({
  value,
  onChange,
  compact = false,
  relayMintFailed = false,
  relayMintRetrying = false
}: {
  value: MobilePairingConnectionMode
  onChange: (value: MobilePairingConnectionMode) => void
  compact?: boolean
  /** When true, show Unavailable on the Relay row (mint failed; no QR). */
  relayMintFailed?: boolean
  relayMintRetrying?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const [relayStatus, setRelayStatus] = useState<MobileRelayStatusDetail>({ status: 'offline' })
  const relayDisabled = relayMintRetrying
  const optionRefs = useRef<Record<MobilePairingConnectionMode, HTMLDivElement | null>>({
    automatic: null,
    'local-only': null
  })

  // Wrap/focus radio arrow navigation, but leave nested controls’ arrows untouched.
  const handleArrowKeys = (event: React.KeyboardEvent): void => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      return
    }
    const target = event.target
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'radio') {
      return
    }
    if (relayDisabled && value !== 'automatic') {
      return
    }
    event.preventDefault()
    const next: MobilePairingConnectionMode =
      relayDisabled || value === 'automatic' ? 'local-only' : 'automatic'
    onChange(next)
    optionRefs.current[next]?.focus()
  }

  const relayCell = relayStatus.cellUrl ? relayCellLabel(relayStatus.cellUrl) : null

  useEffect(() => {
    let receivedEvent = false
    let active = true
    const apply = (detail: MobileRelayStatusDetail): void => {
      setRelayStatus(detail)
    }
    const unsubscribe = window.api.mobile.onRelayStatusChanged((detail) => {
      receivedEvent = true
      if (active) {
        apply(detail)
      }
    })
    void window.api.mobile
      .getRelayStatus()
      .then((detail) => {
        if (active && !receivedEvent) {
          apply(detail)
        }
      })
      .catch(() => {})
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <div className={cn('space-y-2', compact && 'space-y-1.5')}>
      <div
        role="radiogroup"
        aria-label={t(
          'auto.components.settings.MobilePairingConnectionOptions.pathGroup',
          'How the phone reaches this computer'
        )}
        onKeyDown={handleArrowKeys}
        className="overflow-hidden rounded-md border border-border"
      >
        <MobilePairingPathOption
          selected={value === 'automatic'}
          tabIndex={value === 'automatic' && !relayDisabled ? 0 : -1}
          disabled={relayDisabled}
          positionInSet={1}
          setSize={2}
          optionRef={(el) => {
            optionRefs.current.automatic = el
          }}
          onSelect={() => onChange('automatic')}
          title={t(
            'auto.components.settings.MobilePairingConnectionOptions.anywhereTitle',
            'Orca Relay'
          )}
          description={t(
            'auto.components.settings.MobilePairingConnectionOptions.anywhereDescriptionNoAccount',
            'Phone can be on cellular or any Wi‑Fi, through the Seal relay. No account needed.'
          )}
          trailing={
            value === 'automatic' ? (
              <Badge variant="outline" className="text-[11px]">
                {relayMintRetrying
                  ? t(
                      'auto.components.settings.MobilePairingConnectionOptions.retrying',
                      'Retrying'
                    )
                  : relayMintFailed
                    ? t(
                        'auto.components.settings.MobilePairingConnectionOptions.unavailable',
                        'Unavailable'
                      )
                    : relayStatusLabel(relayStatus.status, t)}
              </Badge>
            ) : null
          }
        />
        {value === 'automatic' && !relayMintFailed && relayStatus.clockOffsetMs !== undefined ? (
          <p className="border-t border-border/60 px-3 py-2 text-xs text-destructive" role="alert">
            {relayClockSkewMessage(relayStatus.clockOffsetMs, t)}
          </p>
        ) : null}
        {value === 'automatic' && relayCell ? (
          <p
            className="border-t border-border/60 py-2 pl-10 pr-3 text-xs text-muted-foreground"
            data-testid="relay-cell-line"
          >
            {t('auto.components.settings.MobilePairingConnectionOptions.relayCell', 'Relay cell')}
            {`: ${relayCell}`}
          </p>
        ) : null}
        <div className="border-t border-border" />
        <MobilePairingPathOption
          selected={value === 'local-only'}
          tabIndex={value === 'local-only' || relayDisabled ? 0 : -1}
          positionInSet={2}
          setSize={2}
          optionRef={(el) => {
            optionRefs.current['local-only'] = el
          }}
          onSelect={() => onChange('local-only')}
          title={t('auto.components.settings.MobilePairingConnectionOptions.localTitle', 'LAN')}
          description={t(
            'auto.components.settings.MobilePairingConnectionOptions.localDescription',
            'Phone must be on this Wi‑Fi or connected through Tailscale. No account needed.'
          )}
        />
      </div>
    </div>
  )
}
