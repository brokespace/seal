import { useMemo } from 'react'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { rowConversationName } from '@/components/dashboard/snapshot/dashboard-card-labels'
import {
  getStructuredAgentSessionTabsByPaneKey,
  type StructuredTab
} from '@/components/native-chat/session/status/structured-agent-session-tabs'
import { useWorktreeAgentRows } from '@/components/sidebar/workspace-card/activity/useWorktreeAgentRows'
import { getSharedWorktreeAgentRowsSelector } from '@/components/sidebar/workspace-card/activity/worktree-agent-rows-projection'
import { getStructuredChatTabNames } from '@/runtime/native-chat/naming/structured-chat-name-observation'
import { readStructuredChatTabSavedName } from '@/runtime/native-chat/naming/structured-chat-tab-name'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionRegistryStore, useLiveSessions } from '../live-session-registry-store'
import { windowAgentSession } from '../window-sessions/window-agent-session'
import { windowAgentSessionMachine } from '../window-sessions/window-agent-session-machine'
import {
  workspaceSessionList,
  type WorkspaceSessionListInputs
} from '../window-sessions/workspace-session-list'
import type { ProjectHostSetupProjection } from '../../../../../shared/project-host-setup-projection'
import { getProjectHostSetupProjectionFromState } from '@/store/projects/project-host-setup-selector'
import { useProjectHostSetupProjection } from '@/store/projects/use-project-host-setup-projection'
import type { LiveSessionLink } from './live-session-links'
import { listedProjectHeadersStore, useListedProjectHeaders } from './listed-project-headers-store'
import {
  buildSessionProjectCatalog,
  type SessionProjectCatalog,
  type SessionProjectCatalogInputs
} from './session-project-catalog'
import { groupSidebarSessions, type SidebarSessionGroups } from './sidebar-session-groups'
import { readLiveSessionLinks, useLiveSessionLinks } from './use-live-session-links'

type Inputs = readonly [
  readonly LiveSession[],
  ReadonlyMap<string, LiveSessionLink>,
  AppState['repos'],
  AppState['projectGroups'],
  ProjectHostSetupProjection,
  ReadonlySet<string>
]

const NONE: readonly LiveSession[] = []

let catalogMemo: { inputs: readonly unknown[]; value: SessionProjectCatalog } | null = null
let groupsMemo: { inputs: Inputs; value: SidebarSessionGroups } | null = null

function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.every((input, index) => input === b[index])
}

function catalogFor(inputs: SessionProjectCatalogInputs): SessionProjectCatalog {
  const key = [inputs.repos, inputs.projectGroups, inputs.projection]
  if (!catalogMemo || !same(catalogMemo.inputs, key)) {
    catalogMemo = { inputs: key, value: buildSessionProjectCatalog(inputs) }
  }
  return catalogMemo.value
}

/** The projects the sidebar has headers for, as sessions are matched to them. */
export function useSessionProjectCatalog(): SessionProjectCatalog {
  const repos = useAppStore((state) => state.repos)
  const projectGroups = useAppStore((state) => state.projectGroups)
  const projection = useProjectHostSetupProjection()
  return catalogFor({ repos, projectGroups, projection })
}

/** Every card, header and group asks in one render; the answer is worked out once per change. */
function groupsFor(inputs: Inputs): SidebarSessionGroups {
  if (!groupsMemo || !same(groupsMemo.inputs, inputs)) {
    const [sessions, links, repos, projectGroups, projection, listed] = inputs
    const catalog = catalogFor({ repos, projectGroups, projection })
    groupsMemo = { inputs, value: groupSidebarSessions(sessions, links, catalog, listed) }
  }
  return groupsMemo.value
}

/** Where the sidebar lists every session: on a workspace's card, under a project, or with no project. */
export function useSidebarSessionGroups(): SidebarSessionGroups {
  const { sessions } = useLiveSessions()
  const { links } = useLiveSessionLinks()
  const repos = useAppStore((state) => state.repos)
  const projectGroups = useAppStore((state) => state.projectGroups)
  const projection = useProjectHostSetupProjection()
  const listed = useListedProjectHeaders()
  return groupsFor([sessions, links, repos, projectGroups, projection, listed])
}

/** The same answer outside a render, for an action that runs once. */
export function readSidebarSessionGroups(): SidebarSessionGroups {
  const state = useAppStore.getState()
  return groupsFor([
    liveSessionRegistryStore.getState().sessions,
    readLiveSessionLinks().links,
    state.repos,
    state.projectGroups,
    getProjectHostSetupProjectionFromState(state),
    listedProjectHeadersStore.getState()
  ])
}

/** A chat goes by the name its record will carry; a pane known by its title alone, by what that title names. */
function windowSessionName(
  state: AppState,
  row: DashboardAgentRow,
  chat: StructuredTab | undefined
): string | null {
  if (chat) {
    return readStructuredChatTabSavedName(chat, state)
  }
  if (row.entry.observation?.origin !== 'title') {
    return null
  }
  return (
    rowConversationName(
      row,
      state.settings?.tabAutoGenerateTitle === true,
      state.terminalLayoutsByTabId?.[row.tab.id],
      state.runtimePaneTitlesByTabId?.[row.tab.id],
      getStructuredChatTabNames(),
      state.unifiedTabsByWorktree
    ) ?? null
  )
}

/** Reads the clock as the agent rows' own selector does: each new `rows` carries a fresh decay state. */
function windowSessionBuilder(
  worktreeId: string,
  all: readonly LiveSession[]
): WorkspaceSessionListInputs['build'] {
  const now = Date.now()
  const state = useAppStore.getState()
  const cwd = findWorktreeById(state, worktreeId)?.path ?? null
  return (row, chat, subagents) =>
    windowAgentSession(
      row,
      {
        worktreeId,
        machine: windowAgentSessionMachine(state, row, worktreeId, all),
        chat,
        name: windowSessionName(state, row, chat),
        cwd,
        subagents
      },
      now
    )
}

/**
 * Every session of a workspace, running or ended: the registry's records in its order, then each
 * agent this window's own panes and chats show that no record covers yet, so a session is listed
 * as soon as either knows it and only once. `worktreeId` is a git worktree's id or a folder
 * workspace's key; `hostId` keeps to the agents of one of its hosts.
 */
export function useWorkspaceSessions(
  worktreeId: string,
  hostId?: ExecutionHostId
): readonly LiveSession[] {
  const listed = useSidebarSessionGroups().byWorkspace.get(worktreeId) ?? NONE
  const { sessions: all } = useLiveSessions()
  const rows = useWorktreeAgentRows(worktreeId, true, hostId)
  // Every workspace's chats: the map stays the same while no chat tab changes anywhere.
  const chats = useAppStore((state) =>
    getStructuredAgentSessionTabsByPaneKey(state.unifiedTabsByWorktree)
  )
  return useMemo(
    () =>
      workspaceSessionList({
        listed,
        all,
        rows,
        chats,
        build: windowSessionBuilder(worktreeId, all)
      }),
    [listed, all, rows, chats, worktreeId]
  )
}

let workspaceMemo: { inputs: readonly unknown[]; value: readonly LiveSession[] } | null = null

/** The same list outside a render, for every host of the workspace; the same array while nothing it is made from changes. */
export function readWorkspaceSessions(worktreeId: string): readonly LiveSession[] {
  const state = useAppStore.getState()
  const listed = readSidebarSessionGroups().byWorkspace.get(worktreeId) ?? NONE
  const all = liveSessionRegistryStore.getState().sessions
  const rows = getSharedWorktreeAgentRowsSelector(worktreeId)(state)
  const chats = getStructuredAgentSessionTabsByPaneKey(state.unifiedTabsByWorktree)
  const inputs = [worktreeId, listed, all, rows, chats]
  if (!workspaceMemo || !same(workspaceMemo.inputs, inputs)) {
    workspaceMemo = {
      inputs,
      value: workspaceSessionList({
        listed,
        all,
        rows,
        chats,
        build: windowSessionBuilder(worktreeId, all)
      })
    }
  }
  return workspaceMemo.value
}

/** The sessions no workspace holds that sit right under a project's header in the list. */
export function useProjectHeaderSessions(headerKey: string): readonly LiveSession[] {
  return useSidebarSessionGroups().byHeader.get(headerKey) ?? NONE
}
