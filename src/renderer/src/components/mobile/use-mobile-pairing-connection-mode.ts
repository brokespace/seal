import { useState } from 'react'
import { useAppStore } from '@/store'
import {
  resolveMobilePairingConnectionMode,
  type MobilePairingConnectionMode
} from '../../../../shared/remote-runtime/pairing/mobile-pairing-connection-mode'

/** Resolve the persisted mode consistently across MobilePage and MobilePane. */
export function useMobilePairingConnectionMode(): [
  MobilePairingConnectionMode,
  React.Dispatch<React.SetStateAction<MobilePairingConnectionMode>>
] {
  const savedConnectionMode = useAppStore((s) => s.settings?.mobilePairingConnectionMode)
  const [connectionMode, setConnectionMode] = useState<MobilePairingConnectionMode>(() =>
    resolveMobilePairingConnectionMode(savedConnectionMode)
  )
  const [resolvedFrom, setResolvedFrom] = useState(savedConnectionMode)
  if (resolvedFrom !== savedConnectionMode) {
    setResolvedFrom(savedConnectionMode)
    setConnectionMode(resolveMobilePairingConnectionMode(savedConnectionMode))
  }
  return [connectionMode, setConnectionMode]
}
