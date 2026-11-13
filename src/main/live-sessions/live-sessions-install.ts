import { hostname } from 'node:os'
import { app } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import { localAiVaultScanRoots } from '../ai-vault/discovery/ai-vault-scan-roots'
import { connectedSshHosts, localHost } from './hosts/live-session-hosts'
import { aiVaultTranscriptFiles } from './discovery/local-transcript-files'
import { LiveSessionService } from './live-session-service'
import { createSealPaneAccess } from './seal-panes/seal-pane-runtime'
import { registerLiveSessionIpc } from './live-sessions-ipc'
import { getLiveSessionService, setLiveSessionService } from './live-session-service-instance'

export function installLiveSessions(runtime: OrcaRuntimeService): LiveSessionService {
  const existing = getLiveSessionService()
  if (existing) {
    return existing
  }
  // Discovery reads `ps`, tmux and transcripts with a POSIX shell; Windows reaches its SSH hosts only.
  const local =
    process.platform === 'win32'
      ? null
      : localHost(hostname(), aiVaultTranscriptFiles(localAiVaultScanRoots))
  const sealPanes = createSealPaneAccess(runtime, {
    snapshot: () => agentHookServer.getStatusSnapshot()
  })
  const service = new LiveSessionService({
    userDataPath: app.getPath('userData'),
    hosts: () => [...(local ? [local] : []), ...connectedSshHosts()],
    sealPanes,
    log: (message, error) => console.warn(message, error ?? '')
  })
  registerLiveSessionIpc(service)
  setLiveSessionService(service)
  service.start()
  app.on('will-quit', () => service.stop())
  return service
}
