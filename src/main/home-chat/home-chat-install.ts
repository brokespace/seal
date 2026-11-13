import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type { HomeChatEvent } from '../../shared/home-chat/home-chat-types'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import type { Repo } from '../../shared/repo-types'
import { createClaudeAccountsProvider } from './home-chat-accounts'
import { HomeChatService } from './home-chat-service'
import { HomeChatStore } from './home-chat-store'
import { createDefaultHomeChatMachineProvider } from './machines/home-chat-machine-provider'
import { runOrcaCli } from './tools/home-chat-orca-cli'

export type HomeChatInstallDeps = {
  claudeAccounts: { listAccounts: () => ClaudeRateLimitAccountsState }
  repos: () => Repo[]
  idleCloseMs?: () => number | null
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
  ready = HomeChatStore.open(rootDir).then(async (store) => {
    const service = new HomeChatService({
      rootDir,
      store,
      accounts: createClaudeAccountsProvider(deps.claudeAccounts),
      createMachines: createDefaultHomeChatMachineProvider,
      runOrcaCli,
      repos: deps.repos,
      idleCloseMs: deps.idleCloseMs,
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
