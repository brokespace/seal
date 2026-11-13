import { hostname } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import {
  claudeProjectsRootDirs,
  codexHomeSessionsDir
} from '../ai-vault/discovery/session-scanner-roots'
import { configuredAdditionalCodexHomePaths } from '../ai-vault/discovery/ai-vault-scan-roots'
import { connectedSshHosts, LOCAL_HOST_ID, localHost } from './hosts/live-session-hosts'
import { LiveSessionService } from './live-session-service'
import { createSealPaneAccess } from './seal-panes/seal-pane-runtime'
import { registerLiveSessionIpc } from './live-sessions-ipc'
import { getLiveSessionService, setLiveSessionService } from './live-session-service-instance'

/** Same transcript roots AI Vault indexes on this machine (account profiles, config overrides). */
function localExtraRoots(): { claudeProjectsDirs: string[]; codexSessionsDirs: string[] } {
  return {
    claudeProjectsDirs: claudeProjectsRootDirs({ wslHomeDirs: [] }),
    codexSessionsDirs: [
      codexHomeSessionsDir(),
      ...configuredAdditionalCodexHomePaths().map((home) => join(home, 'sessions'))
    ]
  }
}

export function installLiveSessions(runtime: OrcaRuntimeService): LiveSessionService {
  const existing = getLiveSessionService()
  if (existing) {
    return existing
  }
  // Discovery reads `ps`, tmux and transcripts with a POSIX shell; Windows reaches its SSH hosts only.
  const local = process.platform === 'win32' ? null : localHost(hostname())
  const sealPanes = createSealPaneAccess(runtime, {
    snapshot: () => agentHookServer.getStatusSnapshot()
  })
  const service = new LiveSessionService({
    userDataPath: app.getPath('userData'),
    hosts: () => [...(local ? [local] : []), ...connectedSshHosts()],
    sealPanes,
    extraRoots: (hostId) =>
      hostId === LOCAL_HOST_ID
        ? localExtraRoots()
        : { claudeProjectsDirs: [], codexSessionsDirs: [] },
    log: (message, error) => console.warn(message, error ?? '')
  })
  registerLiveSessionIpc(service)
  setLiveSessionService(service)
  service.start()
  app.on('will-quit', () => service.stop())
  return service
}
