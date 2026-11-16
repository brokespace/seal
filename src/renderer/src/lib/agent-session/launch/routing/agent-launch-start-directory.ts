import { relativePathInsideRoot } from '../../../../../../shared/cross-platform-path'
import { isFloatingWorkspaceId } from '../../../../../../shared/floating-workspace-worktree'
import {
  requestsCwdOutsideWorkspaceRootForWorkspace,
  resolveTerminalStartupCwd,
  resolveTerminalWorkspacePath
} from '../../../../../../shared/shell/launch/terminal-startup-cwd'
import { findFirstIndexedWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner-index'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import type { AppState } from '@/store/types'
import type { Worktree } from '../../../../../../shared/worktree/types'

export type AgentLaunchStartDirectory =
  | { kind: 'workspace-root' }
  /** `launchDirectory` is relative to the workspace root, so the host anchors it at its own root. */
  | { kind: 'workspace-subfolder'; launchDirectory: string }
  | { kind: 'outside-workspace' }

const WORKSPACE_ROOT: AgentLaunchStartDirectory = { kind: 'workspace-root' }
const OUTSIDE_WORKSPACE: AgentLaunchStartDirectory = { kind: 'outside-workspace' }

/** Where a requested start directory lies; an unknown root or a floating workspace proves nothing, so stays outside. */
export function classifyAgentLaunchStartDirectory(args: {
  workspaceId?: string
  requestedCwd?: string | null
  workspacePath?: string | null
  resolveFolderWorkspacePath?: (folderWorkspaceId: string) => string | null | undefined
}): AgentLaunchStartDirectory {
  if (!requestsCwdOutsideWorkspaceRootForWorkspace(args)) {
    return WORKSPACE_ROOT
  }
  if (isFloatingWorkspaceId(args.workspaceId)) {
    return OUTSIDE_WORKSPACE
  }
  const workspacePath =
    args.workspacePath ??
    resolveTerminalWorkspacePath(args.workspaceId, args.resolveFolderWorkspacePath)
  const resolved = workspacePath
    ? resolveTerminalStartupCwd(workspacePath, args.requestedCwd)
    : undefined
  const launchDirectory =
    workspacePath && resolved ? relativePathInsideRoot(workspacePath, resolved) : null
  return launchDirectory ? { kind: 'workspace-subfolder', launchDirectory } : OUTSIDE_WORKSPACE
}

export type AgentLaunchStartDirectoryStore = {
  worktreesByRepo?: AppState['worktreesByRepo']
  folderWorkspaces?: AppState['folderWorkspaces']
}

/** Reads the workspace root from the store's rows before deriving it from the id. */
export function agentLaunchStartDirectoryInWorkspace(
  store: AgentLaunchStartDirectoryStore,
  worktreeId: string | undefined,
  requestedCwd: string | null | undefined
): AgentLaunchStartDirectory {
  if (!requestedCwd?.trim()) {
    return WORKSPACE_ROOT
  }
  return classifyAgentLaunchStartDirectory({
    workspaceId: worktreeId,
    requestedCwd,
    workspacePath: worktreeId
      ? findFirstIndexedWorktree<Worktree>(selectWorktreesByRepo(store) ?? {}, worktreeId)?.path
      : undefined,
    resolveFolderWorkspacePath: (folderWorkspaceId) =>
      selectFolderWorkspaces(store)?.find((entry) => entry.id === folderWorkspaceId)?.folderPath
  })
}
