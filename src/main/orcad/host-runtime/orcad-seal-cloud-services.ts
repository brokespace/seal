import { getAppEnvironment } from '../../../shared/app-environment'
import { resolveSealRelayOrigin } from '../../../shared/seal-cloud/seal-service-origins'
import {
  createSealRelayContextReader,
  sealRelayEndpointConfig
} from '../../runtime/mobile-cloud-relay/authentication/seal-relay-host-auth'
import { DesktopRelayService } from '../../runtime/mobile-cloud-relay/desktop-relay-service'
import { createDesktopRelayServiceInstaller } from '../../runtime/mobile-cloud-relay/desktop-relay-service-installer'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { DesktopPushService } from '../../runtime/push/desktop-push-service'
import { resolvePushGatewayOrigin } from '../../runtime/push/push-gateway-origin'
import type { OrcaRuntimeRpcServer } from '../../runtime/rpc/server/runtime-rpc'

/** Push and the Seal relay for headless hosts; both authenticate with the host's pairing key. */
export function startOrcadSealCloudServices(input: {
  runtime: OrcaRuntimeService
  rpc: OrcaRuntimeRpcServer
  userDataPath: string
  registerCleanup: (cleanup: () => void) => void
}): void {
  const { runtime, rpc, userDataPath, registerCleanup } = input
  const environment = getAppEnvironment()
  const pushService = DesktopPushService.create({
    runtime,
    runtimeRpc: rpc,
    gatewayUrl: resolvePushGatewayOrigin(process.env, environment.isPackaged())
  })
  pushService?.start()
  environment.onWillQuit(() => pushService?.stop())

  let relay: DesktopRelayService | null = null
  let stopping = false
  const installer = createDesktopRelayServiceInstaller({
    runtimeRpc: rpc,
    whenNetworkReady: Promise.resolve(),
    isFenced: () => stopping,
    create: () => {
      const relayOrigin = resolveSealRelayOrigin(process.env, environment.isPackaged())
      return new DesktopRelayService({
        authConfig: sealRelayEndpointConfig(relayOrigin),
        readContext: (keypair) => createSealRelayContextReader({ relayOrigin, keypair }),
        userDataPath,
        appVersion: environment.getVersion(),
        runtimeRpc: rpc,
        onStatus: (status) => console.error(`[orcad] relay ${status}`)
      })
    },
    onInstalled: (installed) => {
      relay = installed
    }
  })
  rpc.setMobileRelayPairingProviderInstaller(() => installer.ensure())
  registerCleanup(() => {
    stopping = true
    relay?.stop()
  })
  void installer.ensure()
}
