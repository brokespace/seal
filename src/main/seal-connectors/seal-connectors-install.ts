import type { SealAccountManager } from '../seal-accounts/seal-account-manager'
import { setSealConnectorsHost, type SealPluginLibrary } from './seal-connectors-host'
import { startSealConnectorsAccountCopies, sealClaudeHomes } from './seal-connectors-account-copies'
import { startSealConnectorsRefresher } from './seal-connectors-refresher'
import { sealConnectorRelayPort, startSealConnectorRelay } from './seal-connector-relay'
import { seedSealConnectors } from './seal-connectors-seed'
import { SealConnectorsService } from './seal-connectors-service'
import { createSealPluginLibrary } from './seal-plugin-library'
import { setSealPluginLibrary } from './seal-connectors-plugins'
import { resolveMachineConnection } from '../machines/machine-services'
import { LOCAL_MACHINE_ID } from '../../shared/machines/machine-types'

let service: SealConnectorsService | null = null
let stops: (() => void)[] = []

export function getSealConnectorsService(): SealConnectorsService | null {
  return service
}

export function requireSealConnectorsService(): SealConnectorsService {
  if (!service) {
    throw new Error('Connectors are not available in this runtime.')
  }
  return service
}

type InstallDeps = {
  manager: Pick<SealAccountManager, 'host' | 'dataRoot' | 'services' | 'store'>
  library?: SealPluginLibrary
}

/** Every runtime (desktop and each orcad) keeps its own list and sign-ins and refreshes as asked. */
export function installSealConnectors(deps: InstallDeps): SealConnectorsService {
  for (const stop of stops) {
    stop()
  }
  service?.dispose()
  const { manager } = deps
  const library =
    deps.library ??
    createSealPluginLibrary({
      userData: manager.dataRoot,
      connection: resolveMachineConnection(LOCAL_MACHINE_ID)
    })
  setSealPluginLibrary(library)
  const created = new SealConnectorsService({
    host: manager.host,
    dataRoot: manager.dataRoot,
    library
  })
  service = created
  setSealConnectorsHost(created)
  const router = manager.services.claudeRuntimeAuth.router
  const defaultHome = (): string => router.systemDefaultHome()
  created.begin(() =>
    seedSealConnectors(created, {
      userHome: router.userHome,
      defaultHome,
      userConfigDir: () => router.userConfigDir()
    })
  )
  const copies = startSealConnectorsAccountCopies(created, {
    homes: () => sealClaudeHomes(manager, defaultHome())
  })
  created.refresher = startSealConnectorsRefresher(created, { onTick: () => void copies.pass() })
  created.setRelayPortSource(sealConnectorRelayPort)
  // Up from boot, on its saved port, so sessions that outlived a restart reach it again.
  void startSealConnectorRelay().catch((error: unknown) => {
    console.warn(
      '[seal-connectors] The relay did not start:',
      error instanceof Error ? error.name : ''
    )
  })
  stops = [copies.stop]
  return created
}
