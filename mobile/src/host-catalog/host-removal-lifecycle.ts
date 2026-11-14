import type { QueryClient } from '@tanstack/react-query'
import { discardConnectionLogs } from '../diagnostics/connection/persisted-connection-log-store'
import { wipeHostStore } from '../device-store/device-store'
import {
  deleteHostPageCache,
  forgetHostUpdateFailures
} from '../mobile-web-shell/generations/removed-host-shell-cache'
import { unregisterPushForRemovedHost } from '../notifications/push-registration'
import { forgetNativeHostQueries } from '../query/native-query-persistence'
import { forgetHostDescriptor } from '../host-descriptors/host-descriptor-store'
import { removeHost } from './host-store'

export async function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void,
  queryClient: QueryClient
): Promise<void> {
  // Unregister before removal while the client is authenticated; an unreachable desktop is asked again later.
  const pushRegistration = await unregisterPushForRemovedHost(hostId)
  // Close only after metadata commits so storage failure cannot strand a still-paired host.
  try {
    await removeHost(hostId)
  } catch (error) {
    pushRegistration.restore()
    throw error
  }
  pushRegistration.commit()
  forgetHostClient(hostId)
  forgetHostDescriptor(hostId)
  // Before the wipe, so nothing this world still holds is written back after it.
  forgetNativeHostQueries(queryClient, hostId)
  // After commit, cache cleanup must not delay/fail removal; later eviction can reclaim failures.
  void forgetHostUpdateFailures(hostId).catch(() => undefined)
  void deleteHostPageCache(hostId).catch(() => undefined)
  void wipeHostStore(hostId).catch(() => undefined)
  void discardConnectionLogs(hostId).catch(() => undefined)
}
