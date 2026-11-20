import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react'
import { cn } from '../../lib/class-names'
import type { PairingNetworkInterface } from '../../../../shared/pairing-address-auto-selection'
import type { MobilePairingConnectionMode } from '../../../../shared/remote-runtime/pairing/mobile-pairing-connection-mode'
import type { MobileRelayMintFailure } from '../../../../shared/remote-runtime/relay/mobile-relay-mint-failure'
import { MobileHeroPairingStep } from './MobileHeroPairingStep'
import { useTranslate } from '@/i18n/use-translate'

export type StepIndex = 0 | 1

type HeroFlowProps = {
  stepIdx: StepIndex
  onOpenInstallGuide: () => void
  pairQrDataUrl: string | null
  pairQrSize?: number | null
  pairingUrl: string | null
  pairingQrError: boolean
  relayMintFailure: MobileRelayMintFailure | null
  onUseLan: () => void
  onRetryRelay: () => void
  onCopyRelayDiagnostics: () => void
  pairLoading: boolean
  connectionMode: MobilePairingConnectionMode
  onConnectionModeChange: (mode: MobilePairingConnectionMode) => void
  onRegeneratePairing: () => void
  onCopyPairingCode: () => void
  networkInterfaces: readonly PairingNetworkInterface[]
  customAddresses: readonly string[]
  selectedAddress: string | undefined
  selectedAddressIsCustom: boolean
  onSelectedAddressChange: (address: string) => void
  onCustomAddressSelect: (address: string) => void
  onCustomAddressRemove: (address: string) => void
  beforeCustomAddressChange: (address: string) => Promise<boolean>
  onRefreshNetworkInterfaces: () => void
  refreshingNetworkInterfaces: boolean
  onBack: () => void
  onContinue: () => void
  onDone?: () => void
}

export function HeroFlow({
  stepIdx,
  onOpenInstallGuide,
  pairQrDataUrl,
  pairQrSize = null,
  pairingUrl,
  pairingQrError,
  relayMintFailure,
  onUseLan,
  onRetryRelay,
  onCopyRelayDiagnostics,
  pairLoading,
  connectionMode,
  onConnectionModeChange,
  onRegeneratePairing,
  onCopyPairingCode,
  networkInterfaces,
  customAddresses,
  selectedAddress,
  selectedAddressIsCustom,
  onSelectedAddressChange,
  onCustomAddressSelect,
  onCustomAddressRemove,
  beforeCustomAddressChange,
  onRefreshNetworkInterfaces,
  refreshingNetworkInterfaces,
  onBack,
  onContinue,
  onDone
}: HeroFlowProps): React.JSX.Element {
  const t = useTranslate()
  const isLast = stepIdx === 1
  const screenRefs = useRef<(HTMLDivElement | null)[]>([])
  const [viewportHeight, setViewportHeight] = useState<number>()

  useLayoutEffect(() => {
    const activeScreen = screenRefs.current[stepIdx]
    if (!activeScreen) {
      return
    }

    const measure = (): void => setViewportHeight(activeScreen.scrollHeight)
    measure()

    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(activeScreen)
    return () => observer.disconnect()
  }, [stepIdx])

  return (
    <div className="mp-flow-card">
      <div
        className="mp-flow-viewport"
        style={viewportHeight === undefined ? undefined : { height: viewportHeight }}
      >
        <div
          ref={(element) => {
            screenRefs.current[0] = element
          }}
          className={cn('mp-flow-screen', stepIdx === 0 ? 'is-active' : 'is-past')}
          aria-hidden={stepIdx !== 0}
          inert={stepIdx !== 0}
        >
          <div className="mp-step2-layout">
            <div className="mp-step2-copy">
              <div className="mp-eyebrow-row">
                <div className="mp-step-num">{stepIdx + 1}</div>
                <span className="mp-eyebrow">
                  {t('auto.components.mobile.MobileHero.92ddfdfa1f', 'Step 1 of 2')}
                </span>
              </div>
              <h2 className="mp-h2">
                {t('auto.components.mobile.MobileHero.installHeading', 'Install Seal Mobile.')}
              </h2>
              <p className="mp-lead-sm">
                {t(
                  'auto.components.mobile.MobileHero.installLead',
                  'Seal Mobile is not on the App Store or Google Play. Build and install it from the Seal repository, then continue to step 2 for the pairing QR.'
                )}
              </p>
              <div className="mp-inline-actions">
                <button type="button" className="mp-ghost-action" onClick={onOpenInstallGuide}>
                  {t('auto.components.mobile.MobileHero.installGuide', 'Open install guide')}
                  <ExternalLink className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          ref={(element) => {
            screenRefs.current[1] = element
          }}
          className={cn('mp-flow-screen', stepIdx === 1 && 'is-active')}
          aria-hidden={stepIdx !== 1}
          inert={stepIdx !== 1}
        >
          <MobileHeroPairingStep
            pairQrDataUrl={pairQrDataUrl}
            pairQrSize={pairQrSize}
            pairingUrl={pairingUrl}
            pairingQrError={pairingQrError}
            relayMintFailure={relayMintFailure}
            onUseLan={onUseLan}
            onRetryRelay={onRetryRelay}
            onCopyRelayDiagnostics={onCopyRelayDiagnostics}
            pairLoading={pairLoading}
            connectionMode={connectionMode}
            onConnectionModeChange={onConnectionModeChange}
            onRegeneratePairing={onRegeneratePairing}
            onCopyPairingCode={onCopyPairingCode}
            networkInterfaces={networkInterfaces}
            customAddresses={customAddresses}
            selectedAddress={selectedAddress}
            selectedAddressIsCustom={selectedAddressIsCustom}
            onSelectedAddressChange={onSelectedAddressChange}
            onCustomAddressSelect={onCustomAddressSelect}
            onCustomAddressRemove={onCustomAddressRemove}
            beforeCustomAddressChange={beforeCustomAddressChange}
            onRefreshNetworkInterfaces={onRefreshNetworkInterfaces}
            refreshingNetworkInterfaces={refreshingNetworkInterfaces}
          />
        </div>
      </div>

      <div className="mp-flow-actions">
        <button type="button" className="mp-flow-back" onClick={onBack}>
          <ArrowLeft className="size-3" />
          {t('auto.components.mobile.MobileHero.b622eba64d', 'Back')}
        </button>
        {isLast ? (
          onDone ? (
            <button
              type="button"
              className="mp-primary-action mp-flow-primary-action"
              onClick={onDone}
            >
              {t('auto.components.mobile.MobileHero.3f90dbd274', 'Done')}
              <ArrowRight className="size-3.5" />
            </button>
          ) : (
            <span />
          )
        ) : (
          <button
            type="button"
            className="mp-flow-continue mp-flow-primary-action"
            onClick={onContinue}
          >
            {t('auto.components.mobile.MobileHero.a8fb43cf1c', 'Continue')}
            <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
