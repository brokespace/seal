import { homedir } from 'node:os'
import { isProvisionalLiveSessionId } from '../../../shared/live-sessions/live-session-provisional-id'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { getMainE2EConfig } from '../../startup/testing/e2e-config'
import { LOCAL_HOST_ID } from '../hosts/live-session-hosts'
import type { LiveSessionRegistry } from '../live-session-registry'
import { AutoCreatedSweep } from './auto-created-sweep'
import { FolderProbes } from './folder-probe'
import { WorkspaceCreation } from './workspace-creation'
import { readLinkableWorkspaces, WorkspaceLinkCatalog } from './workspace-link-catalog'
import { WorkspaceLinker } from './workspace-linker'
import { workspacesInUse, workspacesWithTerminals } from './workspaces-in-use'

const LISTING_REFRESH_MS = 30_000
const SWEEP_INTERVAL_MS = 10_000

export type WorkspaceLink = {
  link: (session: LiveSession) => LiveSession
  /** The registry is built with `link`, so it joins only once it exists. */
  start(registry: LiveSessionRegistry): void
  stop(): void
}

/** Wires the workspace link of live sessions to this process's runtime, store and session registry. */
export function installWorkspaceLink(deps: {
  runtime: OrcaRuntimeService
  store: Store
  log: (message: string, error?: unknown) => void
}): WorkspaceLink {
  const { runtime, store, log } = deps
  let registry: LiveSessionRegistry | null = null
  const stops: (() => void)[] = []
  const catalog = new WorkspaceLinkCatalog({
    read: () => readLinkableWorkspaces(runtime, store),
    onChange: () => registry?.republish(),
    log
  })
  const creation = new WorkspaceCreation({ runtime, store, log })
  const linker = new WorkspaceLinker({
    runtime,
    store,
    catalog,
    creation,
    probes: new FolderProbes(),
    host: (machineHostId) => registry?.host(machineHostId) ?? null,
    // A test app lists every agent on the machine, other test apps' and the developer's own included.
    creates: (session) =>
      !getMainE2EConfig().enabled || !isProvisionalLiveSessionId(session.providerSessionId),
    localHome: homedir(),
    onChange: () => registry?.republish(),
    log
  })
  const sweep = new AutoCreatedSweep({
    store,
    creation,
    sessions: () => registry?.getSnapshot().sessions ?? [],
    machineRead: () =>
      registry?.hasRead(`${LOCAL_HOST_ID}:`) === true && catalog.ageMs() < 2 * LISTING_REFRESH_MS,
    inUse: () => workspacesInUse(store),
    terminalWorkspaces: () => workspacesWithTerminals(runtime),
    onRemoved: () => catalog.refresh(),
    log
  })
  const every = (ms: number, run: () => void): void => {
    const timer = setInterval(run, ms)
    timer.unref?.()
    stops.push(() => clearInterval(timer))
  }
  return {
    link: (session) => linker.link(session),
    start(started) {
      if (registry) {
        return
      }
      registry = started
      stops.push(
        registry.subscribe(() => sweep.schedule()),
        runtime.onClientEvent(
          (event) => {
            if (event.type === 'reposChanged' || event.type === 'worktreesChanged') {
              void catalog.refresh()
              sweep.schedule()
            }
          },
          // Counting as a consumer would turn on per-chunk terminal output scanning on headless hosts.
          { consumesTerminalSideEffects: false }
        ),
        () => sweep.stop()
      )
      every(LISTING_REFRESH_MS, () => {
        // The sweep removes nothing on a stale listing, so a project left behind keeps it fresh.
        const watched =
          started.getSnapshot().sessions.length > 0 ||
          store.getRepos().some((repo) => repo.autoCreated)
        if (watched) {
          void catalog.refresh()
        }
      })
      every(SWEEP_INTERVAL_MS, () => void sweep.run())
      void catalog.refresh()
    },
    stop() {
      for (const stop of stops.splice(0)) {
        stop()
      }
    }
  }
}
