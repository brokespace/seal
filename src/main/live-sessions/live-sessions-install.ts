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

let service: LiveSessionService | null = null

/** The running live-session service; null before startup or in builds that don't install it. */
export function getLiveSessionService(): LiveSessionService | null {
  return service
}

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
  if (service) {
    return service
  }
  // Discovery reads `ps`, tmux and transcripts with a POSIX shell; Windows reaches its SSH hosts only.
  const local = process.platform === 'win32' ? null : localHost('This machine')
  const sealPanes = createSealPaneAccess(runtime, {
    snapshot: () => agentHookServer.getStatusSnapshot()
  })
  service = new LiveSessionService({
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
  service.start()
  app.on('will-quit', () => service?.stop())
  return service
}
