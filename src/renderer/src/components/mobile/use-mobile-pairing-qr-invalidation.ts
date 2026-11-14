import { useEffect, useRef } from 'react'
import type { MobilePairingConnectionMode } from '../../../../shared/remote-runtime/pairing/mobile-pairing-connection-mode'

type MutableRef<T> = { current: T }

/** Keep QR policy aligned with mode changes, including ones made in other windows. */
export function useMobilePairingQrInvalidation(params: {
  connectionMode: MobilePairingConnectionMode
  pairLoading: boolean
  hasGeneratedRef: MutableRef<boolean>
  pairingRequestIdRef: MutableRef<number>
  setPairQrDataUrl: (value: string | null) => void
  setPairQrSize: (value: number | null) => void
  setPairingUrl: (value: string | null) => void
  setPairingQrError: (value: boolean) => void
  setPairLoading: (value: boolean) => void
  setRelayMintFailure?: (value: null) => void
  regenerate: (mode: MobilePairingConnectionMode, opts: { rotate: boolean }) => void
}): void {
  const {
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
    regenerate
  } = params
  // Distinguish new cross-window mode preferences from changes already handled here.
  const handledModeRef = useRef(connectionMode)

  // Invalidate late old-policy responses before reminting; the preference is already saved, so do not write it back across windows.
  useEffect(() => {
    if (connectionMode === handledModeRef.current) {
      return
    }
    handledModeRef.current = connectionMode
    pairingRequestIdRef.current += 1
    const shouldRegenerate = hasGeneratedRef.current || pairLoading
    hasGeneratedRef.current = false
    setPairingUrl(null)
    setPairingQrError(false)
    setPairQrDataUrl(null)
    setPairQrSize(null)
    setRelayMintFailure?.(null)
    if (shouldRegenerate) {
      // Main rotates once on mode mismatch so windows reacting to the same preference share one new token.
      regenerate(connectionMode, { rotate: false })
    } else {
      setPairLoading(false)
    }
  }, [
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
    regenerate
  ])
}
