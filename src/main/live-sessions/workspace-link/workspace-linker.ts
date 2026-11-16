import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { liveSessionExecutionHost } from '../../../shared/live-sessions/live-session-execution-host'
import { isPairedServerLiveSession } from '../../../shared/live-sessions/live-session-paired-server'
import { isActiveLiveSession } from '../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { Repo } from '../../../shared/repo-types'
import { getRepoMainWorktreeId, worktreeIdsEqual } from '../../../shared/worktree/id'
import type { Store } from '../../persistence/loading-store/store'
import {
  sessionPaneWorkspaceId,
  type PaneWorkspaceRuntime
} from '../../session-summaries/session-pane-workspace'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import type { FolderProbes } from './folder-probe'
import type { WorkspaceCreation } from './workspace-creation'
import { storedSessionWorkspace, type WorkspaceLinkCatalog } from './workspace-link-catalog'
import {
  planWorkspace,
  workspaceForSession,
  type LinkableWorkspace,
  type SessionWorkspace
} from './workspace-link-rules'

const STALE_LISTING_MS = 3_000
/** How long a folder that got no workspace waits before it is looked at again. */
const RETRY_MS = { later: 10_000, unassigned: 60_000, failed: 300_000 }

type Outcome = 'linked' | keyof typeof RETRY_MS

type FolderPlace = { hostId: string; cwd: string; key: string }

export type WorkspaceLinkerDeps = {
  runtime: PaneWorkspaceRuntime
  store: Pick<Store, 'getRepo' | 'getFolderWorkspaces'>
  catalog: WorkspaceLinkCatalog
  creation: WorkspaceCreation
  probes: FolderProbes
  /** The machine to ask about a folder; null while it cannot be asked. */
  host: (machineHostId: string) => LiveSessionHost | null
  /** False for a session this process makes no project for. */
  creates: (session: LiveSession) => boolean
  localHome: string
  onChange: () => void
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

function folderPlace(session: LiveSession): FolderPlace | null {
  if (!session.cwd) {
    return null
  }
  const hostId =
    session.machine.kind === 'local'
      ? LOCAL_EXECUTION_HOST_ID
      : liveSessionExecutionHost(session.machine)
  return {
    hostId,
    cwd: session.cwd,
    key: `${hostId}\0${normalizeRuntimePathForComparison(session.cwd)}`
  }
}

function sessionWorkspace(workspace: SessionWorkspace): SessionWorkspace {
  return { worktreeId: workspace.worktreeId, projectKey: workspace.projectKey }
}

/** Gives every session the workspace it belongs to, making one for a running session no workspace holds. */
export class WorkspaceLinker {
  private readonly homes = new Map<string, string | null>()
  /** Links the folder rule cannot repeat: a shared folder's home workspace, a hidden checkout's project. */
  private readonly pins = new Map<string, string>()
  private readonly resolving = new Set<string>()
  private readonly retryAt = new Map<string, number>()
  private readonly matches = new Map<string, LinkableWorkspace | null>()
  private listed: readonly LinkableWorkspace[] = []
  private listedById = new Map<string, LinkableWorkspace>()

  constructor(private readonly deps: WorkspaceLinkerDeps) {
    this.homes.set(LOCAL_EXECUTION_HOST_ID, deps.localHome)
  }

  link(session: LiveSession): LiveSession {
    if (session.workspace || isPairedServerLiveSession(session)) {
      return session
    }
    const place = folderPlace(session)
    const workspace = this.tabWorkspace(session) ?? (place ? this.folderWorkspace(place) : null)
    if (workspace) {
      return { ...session, workspace: sessionWorkspace(workspace) }
    }
    const creates = place?.hostId !== LOCAL_EXECUTION_HOST_ID || this.deps.creates(session)
    if (place && creates && isActiveLiveSession(session)) {
      this.resolve(session, place)
    }
    return session
  }

  private workspaces(): readonly LinkableWorkspace[] {
    const listed = this.deps.catalog.list()
    if (listed !== this.listed) {
      this.listed = listed
      this.listedById = new Map(listed.map((workspace) => [workspace.worktreeId, workspace]))
      this.matches.clear()
    }
    return listed
  }

  private tabWorkspace(session: LiveSession): SessionWorkspace | null {
    const worktreeId = sessionPaneWorkspaceId(this.deps.runtime, session.surface)
    if (!worktreeId) {
      return null
    }
    this.workspaces()
    return this.listedById.get(worktreeId) ?? storedSessionWorkspace(this.deps.store, worktreeId)
  }

  private folderWorkspace(place: FolderPlace): LinkableWorkspace | null {
    const found = this.holder(place)
    if (found) {
      return found
    }
    const pinned = this.pins.get(place.key)
    const workspace = pinned ? this.listedById.get(pinned) : undefined
    if (pinned && workspace?.hostId !== place.hostId) {
      this.pins.delete(place.key)
      return null
    }
    return workspace ?? null
  }

  private holder(place: FolderPlace): LinkableWorkspace | null {
    const workspaces = this.workspaces()
    let found = this.matches.get(place.key)
    if (found === undefined) {
      found = workspaceForSession(
        { hostId: place.hostId, cwd: place.cwd, tabWorktreeId: null },
        workspaces,
        this.homes.get(place.hostId) ?? null
      )
      this.matches.set(place.key, found)
    }
    // An ancestor may be the machine's home, which holds only sessions started right in it.
    const unsure =
      found !== null &&
      !this.homes.has(place.hostId) &&
      normalizeRuntimePathForComparison(found.path) !== normalizeRuntimePathForComparison(place.cwd)
    return unsure ? null : found
  }

  private resolve(session: LiveSession, place: FolderPlace): void {
    const now = this.deps.now ?? Date.now
    if (this.resolving.has(place.key) || now() < (this.retryAt.get(place.key) ?? 0)) {
      return
    }
    this.resolving.add(place.key)
    void this.settle(session, place)
      .catch((error: unknown): Outcome => {
        this.deps.log?.(`[live-sessions] no workspace made for ${place.cwd}`, error)
        return 'failed'
      })
      .then((outcome) => {
        this.resolving.delete(place.key)
        for (const [key, at] of this.retryAt) {
          if (now() >= at) {
            this.retryAt.delete(key)
          }
        }
        if (outcome === 'linked') {
          this.deps.onChange()
        } else {
          this.retryAt.set(place.key, now() + RETRY_MS[outcome])
        }
      })
  }

  private async settle(session: LiveSession, place: FolderPlace): Promise<Outcome> {
    const { catalog, creation } = this.deps
    if (catalog.ageMs() > STALE_LISTING_MS) {
      await catalog.refresh()
      if (this.folderWorkspace(place)) {
        return 'linked'
      }
    }
    const host = this.deps.host(session.machine.hostId)
    if (!host) {
      return 'later'
    }
    const probe = await this.deps.probes.read(host, place.cwd)
    if (probe.kind === 'unreadable') {
      return 'later'
    }
    if (!this.homes.has(place.hostId)) {
      this.homes.set(place.hostId, probe.home)
      this.matches.clear()
      if (this.holder(place)) {
        return 'linked'
      }
      // The machine's other sessions were waiting for its home too.
      this.deps.onChange()
    }
    // Seal adds projects on an SSH host only through that host's own server.
    const plan =
      place.hostId === LOCAL_EXECUTION_HOST_ID
        ? planWorkspace(place.cwd, probe)
        : { kind: 'unassigned' as const }
    if (plan.kind === 'unassigned') {
      return 'unassigned'
    }
    const { repo, created } = await creation.ensure(plan, session.machine.label)
    await catalog.refresh()
    if (this.holder(place)) {
      return 'linked'
    }
    const primary = this.primaryWorkspace(repo)
    if (primary) {
      this.pins.set(place.key, primary.worktreeId)
      return 'linked'
    }
    if (created) {
      await creation.remove(repo, 'none of its workspaces can hold the session')
      await catalog.refresh()
    }
    return 'failed'
  }

  private primaryWorkspace(repo: Repo): LinkableWorkspace | null {
    const primary = getRepoMainWorktreeId(repo)
    return (
      this.workspaces().find(
        (workspace) =>
          workspace.hostId === LOCAL_EXECUTION_HOST_ID &&
          worktreeIdsEqual(workspace.worktreeId, primary)
      ) ?? null
    )
  }
}
