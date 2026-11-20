import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useAppStore } from '@/store'
import type { StepIndex } from './MobileHero'
import type { PairingNetworkInterface } from '../../../../shared/pairing-address-auto-selection'
import { translate } from '@/i18n/i18n'
import { useMobilePageEscape } from './use-mobile-page-escape'
import { MobilePageContent } from './MobilePageContent'
import type { MobilePairingConnectionMode } from '../../../../shared/remote-runtime/pairing/mobile-pairing-connection-mode'
import { useMobilePairingConnectionMode } from './use-mobile-pairing-connection-mode'
import { useMobilePairingGeneration } from './use-mobile-pairing-generation'
import { useMobilePairingQrInvalidation } from './use-mobile-pairing-qr-invalidation'
import { SEAL_MOBILE_INSTALL_GUIDE_URL } from './seal-mobile-install-guide'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { useMobilePagePairedDevices } from './use-mobile-page-paired-devices'
import { usePairingOfferExpiry } from './use-pairing-offer-expiry'
import type { MobileRelayMintFailure } from '../../../../shared/remote-runtime/relay/mobile-relay-mint-failure'
import {
  type MobilePairingAddressChange,
  useMobilePairingAddressPreference
} from './use-mobile-pairing-address-preference'

export default function MobilePage(): React.JSX.Element {
  const [stepIdx, setStepIdx] = useState<StepIndex>(0)

  const [pairQrDataUrl, setPairQrDataUrl] = useState<string | null>(null)
  const [pairQrSize, setPairQrSize] = useState<number | null>(null)
  const [pairingUrl, setPairingUrl] = useState<string | null>(null)
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null)
  const [pairingQrError, setPairingQrError] = useState(false)
  const [relayMintFailure, setRelayMintFailure] = useState<MobileRelayMintFailure | null>(null)
  const [pairLoading, setPairLoading] = useState(false)
  const [connectionMode, setConnectionMode] = useMobilePairingConnectionMode()
  const [networkInterfaces, setNetworkInterfaces] = useState<PairingNetworkInterface[]>([])
  const pairingAddressChangeRef = useRef<(change: MobilePairingAddressChange) => void>(() => {})
  const notifyPairingAddressChange = useCallback(
    (change: MobilePairingAddressChange): void => pairingAddressChangeRef.current(change),
    []
  )
  const {
    selectedAddress,
    selectedAddressIsCustom,
    customAddresses,
    selectAddress: handleAddressChange,
    selectCustomAddress: handleCustomAddressSelect,
    removeCustomAddress: handleCustomAddressRemove,
    selectAddressAfterRefresh
  } = useMobilePairingAddressPreference({
    networkInterfaces,
    onSelectionInvalidated: notifyPairingAddressChange
  })
  const [refreshingNetworkInterfaces, setRefreshingNetworkInterfaces] = useState(false)
  const hasGeneratedRef = useRef(false)
  const pairingRequestIdRef = useRef(0)
  // Gate minting on this visit’s settled lookup; a shared busy flag cannot distinguish overlapping requests.
  const [pairingFlowVisit, setPairingFlowVisit] = useState(0)
  const [addressedFlowVisit, setAddressedFlowVisit] = useState<number | null>(null)
  const pairingAddressSettled = addressedFlowVisit === pairingFlowVisit
  const networkInterfacesRequestIdRef = useRef(0)
  const mountedRef = useMountedRef()
  const closeMobilePage = useAppStore((s) => s.closeMobilePage)
  const showMobileButton = useAppStore((s) => s.settings?.showMobileButton !== false)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const {
    devices,
    enterFlow: showFirstPairingFlow,
    handleBack,
    pairAnotherDevice: showPairAnotherDeviceFlow,
    revokeDevice,
    revokingDeviceIds,
    showPairedDevices,
    stage
  } = useMobilePagePairedDevices({ stepIdx, setStepIdx })

  const { generatePairing } = useMobilePairingGeneration({
    connectionMode,
    selectedAddress,
    mountedRef,
    hasGeneratedRef,
    pairingRequestIdRef,
    setPairQrDataUrl,
    setPairQrSize,
    setPairingUrl,
    setPairExpiresAt,
    setPairingQrError,
    setPairLoading,
    setRelayMintFailure
  })
  useLayoutEffect(() => {
    pairingAddressChangeRef.current = ({ address, source }) => {
      if (source === 'user') {
        void generatePairing(true, address ?? '')
        return
      }
      if (source === 'refresh') {
        if (hasGeneratedRef.current) {
          void generatePairing(true, address)
        }
        return
      }
      const shouldRegenerate = hasGeneratedRef.current || pairLoading
      pairingRequestIdRef.current += 1
      hasGeneratedRef.current = false
      setPairQrDataUrl(null)
      setPairQrSize(null)
      setPairingUrl(null)
      setPairingQrError(false)
      setRelayMintFailure(null)
      setPairLoading(false)
      if (shouldRegenerate) {
        void generatePairing(true, address ?? '')
      }
    }
  }, [connectionMode, generatePairing, pairLoading])

  const handleConnectionModeChange = useCallback(
    (nextMode: MobilePairingConnectionMode): void => {
      if (nextMode === connectionMode) {
        return
      }
      // Central invalidation handles QR replacement for both this pick and cross-window preference changes.
      setRelayMintFailure(null)
      setConnectionMode(nextMode)
      void updateSettings({ mobilePairingConnectionMode: nextMode })
    },
    [connectionMode, updateSettings, setConnectionMode]
  )

  const copyRelayDiagnostics = useCallback(async (): Promise<void> => {
    if (relayMintFailure == null) {
      return
    }
    // Why: users share this payload — the selected address would leak a LAN/Tailscale IP or hostname.
    const payload = {
      kind: 'mobile_pairing_relay_failure',
      preferredConnectionMode: connectionMode,
      failure: relayMintFailure,
      at: new Date().toISOString()
    }
    try {
      await window.api.ui.writeClipboardText(JSON.stringify(payload, null, 2))
      if (mountedRef.current) {
        toast.success(
          translate('auto.components.mobile.MobilePage.diagnosticsCopied', 'Diagnostics copied')
        )
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.mobile.MobilePage.diagnosticsCopyFailed',
            'Failed to copy diagnostics'
          )
        )
      }
    }
  }, [connectionMode, mountedRef, relayMintFailure])

  useMobilePairingQrInvalidation({
    connectionMode,
    pairLoading,
    hasGeneratedRef,
    pairingRequestIdRef,
    setPairQrDataUrl,
    setPairQrSize,
    setPairingUrl,
    setPairingQrError,
    setPairLoading,
    setRelayMintFailure,
    regenerate: (mode, opts) => void generatePairing(opts.rotate, undefined, mode)
  })

  const loadNetworkInterfaces = useCallback(async () => {
    const requestId = ++networkInterfacesRequestIdRef.current
    const visit = pairingFlowVisit
    if (mountedRef.current) {
      setRefreshingNetworkInterfaces(true)
    }
    try {
      const result = await window.api.mobile.listNetworkInterfaces()
      // Only the latest lookup may move the address; stale selection changes would remint over the advertised offer.
      if (mountedRef.current && requestId === networkInterfacesRequestIdRef.current) {
        setNetworkInterfaces(result.interfaces)
        selectAddressAfterRefresh(result.interfaces)
      }
    } catch {
      // Network list is non-critical; the QR will still mint with default routing.
    } finally {
      // Only the newest request can settle its visit; older completions must not release minting or roll the marker back.
      if (mountedRef.current && requestId === networkInterfacesRequestIdRef.current) {
        setAddressedFlowVisit(visit)
        setRefreshingNetworkInterfaces(false)
      }
    }
  }, [mountedRef, pairingFlowVisit, selectAddressAfterRefresh])

  useEffect(() => {
    if (stage !== 'flow') {
      return
    }
    void loadNetworkInterfaces()
  }, [stage, loadNetworkInterfaces])

  const beforeCustomAddressChange = useCallback(
    async (address: string): Promise<boolean> => {
      try {
        const result = await window.api.mobile.getPairingQR({ address, connectionMode })
        return result.available && result.qrDataUrl !== null
      } catch {
        return false
      }
    },
    [connectionMode]
  )

  const copyPairingCode = useCallback(async () => {
    if (!pairingUrl) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(pairingUrl)
      if (mountedRef.current) {
        toast.success(
          translate('auto.components.mobile.MobilePage.3c1f7168bb', 'Pairing code copied')
        )
      }
    } catch (err) {
      console.error('writeClipboardText failed', err)
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.mobile.MobilePage.6a66e38943', 'Failed to copy pairing code')
        )
      }
    }
  }, [mountedRef, pairingUrl])

  // Auto-mint on Step 2 once its prerequisites settle; explicit regeneration owns subsequent mints.
  useEffect(() => {
    if (stage !== 'flow' || stepIdx !== 1 || hasGeneratedRef.current) {
      return
    }
    // Wait for this visit’s address before minting or its replacement could rotate away the just-created credential.
    if (!pairingAddressSettled) {
      return
    }
    void generatePairing(false)
  }, [stage, stepIdx, generatePairing, pairingAddressSettled])

  // Refresh only a code on screen; the old one stays valid for a phone mid-scan.
  const pairingCodeShown = stage === 'flow' && stepIdx === 1 && pairingUrl != null
  usePairingOfferExpiry(pairingCodeShown ? pairExpiresAt : null, () => void generatePairing(false))

  // Clear prior QR state on entry so expired codes cannot flash during the fresh visit.
  const beginPairingVisit = (): void => {
    pairingRequestIdRef.current += 1
    setPairLoading(false)
    setPairingFlowVisit((visit) => visit + 1)
    hasGeneratedRef.current = false
    setPairQrDataUrl(null)
    setPairQrSize(null)
    setPairingUrl(null)
    setPairingQrError(false)
    setRelayMintFailure(null)
  }

  const enterFlow = (): void => {
    beginPairingVisit()
    showFirstPairingFlow()
  }

  const pairAnotherDevice = (): void => {
    beginPairingVisit()
    showPairAnotherDeviceFlow()
  }

  const handleContinue = (): void => {
    if (stepIdx === 0) {
      setStepIdx(1)
    }
  }

  const toggleMobileSidebarButton = useCallback(() => {
    const nextShowMobileButton = !showMobileButton
    void updateSettings({ showMobileButton: nextShowMobileButton })
    if (!nextShowMobileButton) {
      toast.message(
        translate(
          'auto.components.mobile.MobilePageToolbar.e1c7b4a92d',
          'Configure in Settings > Mobile.'
        )
      )
    }
  }, [showMobileButton, updateSettings])

  useMobilePageEscape(closeMobilePage)

  // Show address waiting as busy separately from pairLoading, or a mode switch could regenerate before address resolution.
  const awaitingPairingAddress = stage === 'flow' && stepIdx === 1 && !pairingAddressSettled

  return (
    <MobilePageContent
      closeMobilePage={closeMobilePage}
      copyPairingCode={() => void copyPairingCode()}
      devices={devices}
      enterFlow={enterFlow}
      generatePairing={(rotate) => void generatePairing(rotate)}
      handleAddressChange={handleAddressChange}
      customAddresses={customAddresses}
      selectedAddressIsCustom={selectedAddressIsCustom}
      onCustomAddressSelect={handleCustomAddressSelect}
      onCustomAddressRemove={handleCustomAddressRemove}
      beforeCustomAddressChange={beforeCustomAddressChange}
      handleBack={handleBack}
      handleContinue={handleContinue}
      loadNetworkInterfaces={() => void loadNetworkInterfaces()}
      networkInterfaces={networkInterfaces}
      openInstallGuide={() => openAppHttpLink(SEAL_MOBILE_INSTALL_GUIDE_URL)}
      pairAnotherDevice={pairAnotherDevice}
      pairLoading={pairLoading || awaitingPairingAddress}
      connectionMode={connectionMode}
      handleConnectionModeChange={handleConnectionModeChange}
      pairQrDataUrl={pairQrDataUrl}
      pairQrSize={pairQrSize}
      pairingUrl={pairingUrl}
      pairingQrError={pairingQrError}
      relayMintFailure={
        connectionMode === 'automatic' && pairQrDataUrl == null ? relayMintFailure : null
      }
      onUseLan={() => handleConnectionModeChange('local-only')}
      onRetryRelay={() => void generatePairing(true)}
      onCopyRelayDiagnostics={() => void copyRelayDiagnostics()}
      refreshingNetworkInterfaces={refreshingNetworkInterfaces}
      revokeDevice={(id) => void revokeDevice(id)}
      revokingDeviceIds={revokingDeviceIds}
      selectedAddress={selectedAddress}
      showMobileButton={showMobileButton}
      showPairedDevices={showPairedDevices}
      stage={stage}
      stepIdx={stepIdx}
      toggleMobileSidebarButton={toggleMobileSidebarButton}
    />
  )
}
