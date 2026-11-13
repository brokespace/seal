import { app, powerMonitor } from 'electron'
import { resolveSealRelayOrigin } from '../../../shared/seal-cloud/seal-service-origins'
import {
  createSealRelayContextReader,
  sealRelayEndpointConfig
} from '../../runtime/mobile-cloud-relay/authentication/seal-relay-host-auth'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import type { OrcaRuntimeRpcServer } from '../../runtime/rpc/server/runtime-rpc'
import { DesktopRelayService } from '../../runtime/mobile-cloud-relay/desktop-relay-service'
import { createDesktopRelayServiceInstaller } from '../../runtime/mobile-cloud-relay/desktop-relay-service-installer'
import { publishDesktopRelayStatus } from './main-process-relay-status'
import { mainProcessState as state } from '../main-process-state'

// Register before proxy readiness; the installer waits before its first request.
export function startDesktopRelayService(runtimeRpc: OrcaRuntimeRpcServer): void {
  const installer = createDesktopRelayServiceInstaller({
    runtimeRpc,
    whenNetworkReady: state.initialProxyApplicationReady,
    isFenced: () => state.isQuitting,
    create: () => {
      const relayOrigin = resolveSealRelayOrigin(process.env, app.isPackaged)
      return new DesktopRelayService({
        authConfig: sealRelayEndpointConfig(relayOrigin),
        readContext: (keypair) => createSealRelayContextReader({ relayOrigin, keypair }),
        userDataPath: getProfileUserDataPath(),
        appVersion: app.getVersion(),
        runtimeRpc,
        onStatus: publishDesktopRelayStatus
      })
    },
    onInstalled: (service) => {
      state.desktopRelayService = service
    }
  })
  state.desktopRelayInstaller = installer
  runtimeRpc.setMobileRelayPairingProviderInstaller(() => installer.ensure())
  // Sleep can expire the token with no retry timer; resume is the recovery opportunity.
  powerMonitor.on('resume', () => state.desktopRelayService?.ensureLive())
  void installer.ensure()
}
