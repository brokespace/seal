import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type { HomeChatEvent } from '../../shared/home-chat/home-chat-types'
import type {
  ClaudeRateLimitAccountsState,
  CodexManagedAccount
} from '../../shared/managed-account-types'
import type { Repo } from '../../shared/repo-types'
import { getLiveSessionService } from '../live-sessions/live-session-service-instance'
import { getSealAccountManager } from '../seal-accounts/seal-account-manager'
import { createHomeChatAccountProvider } from './home-chat-accounts'
import { HomeChatService } from './home-chat-service'
import { HomeChatSettingsStore } from './home-chat-settings-store'
import {
  createDefaultHomeChatMachineProvider,
  type HomeChatMachineSource
} from './machines/home-chat-machine-provider'
import { createHomeChatAccountAccess } from './seal/home-chat-account-access'
import { createHomeChatSessionAccess } from './seal/home-chat-session-access'
import { HomeChatThreadStore } from './thread/home-chat-thread-store'
import { runOrcaCli } from './tools/home-chat-orca-cli'

export type HomeChatInstallDeps = {
  claudeAccounts: { listAccounts: () => ClaudeRateLimitAccountsState }
  codexAccounts: () => readonly CodexManagedAccount[]
  repos: () => Repo[]
  machines: HomeChatMachineSource
}

let ready: Promise<HomeChatService> | null = null
const listeners = new Set<(event: HomeChatEvent) => void>()

export function homeChatRootDir(): string {
  return join(getAppEnvironment().getPath('userData'), 'home-chat')
}

/** One assistant per host process, shared by the desktop window and paired phones. */
export function installHomeChat(deps: HomeChatInstallDeps): Promise<HomeChatService> {
  if (ready) {
    return ready
  }
  const rootDir = homeChatRootDir()
  ready = Promise.all([
    HomeChatThreadStore.open(rootDir),
    HomeChatSettingsStore.open(rootDir)
  ]).then(async ([threads, settings]) => {
    const service = new HomeChatService({
      rootDir,
      threads,
      settings,
      accounts: createHomeChatAccountProvider({
        sealCandidates: (provider) => getSealAccountManager()?.candidates(provider) ?? null,
        listClaudeAccounts: () => deps.claudeAccounts.listAccounts(),
        listCodexAccounts: deps.codexAccounts
      }),
      createMachines: (machineNotes) =>
        createDefaultHomeChatMachineProvider(machineNotes, deps.machines),
      runOrcaCli,
      repos: deps.repos,
      seal: {
        sessions: createHomeChatSessionAccess({ live: getLiveSessionService }),
        accounts: createHomeChatAccountAccess(getSealAccountManager)
      },
      emit: (event) => {
        for (const listener of listeners) {
          listener(event)
        }
      }
    })
    await service.start()
    return service
  })
  const installed = ready
  getAppEnvironment().onWillQuit(() => {
    void installed.then((service) => service.dispose())
  })
  return ready
}

export function requireHomeChat(): Promise<HomeChatService> {
  if (!ready) {
    throw new Error('Home chat is not available on this host')
  }
  return ready
}

export function onHomeChatEvent(listener: (event: HomeChatEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
