import { workspaceTabs } from '@/lib/agent-session/tab-identity/structured-chat-tab-index'
import { selectExecutionHostDisplayLabel } from '@/runtime/hosts/display/execution-host-display-label'
import { findIndexedRepoOwnerForHost } from '@/lib/workspace/ownership/repo-owner-index'
import { getWslDistroFromPath } from '@/runtime/hosts/preflight/local-preflight-context'
import { selectWslHostDistro } from '@/components/wsl-host-mark/WslHostMark'
import { resolvePaneWslDistro } from '@/components/terminal-pane/host-state/terminal-pane-wsl-distro'
import { getHostSettingOverride } from '../../../../../../shared/host-setting-overrides'
import { isFolderRepo } from '../../../../../../shared/repo-kind'
import { parseWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { isPathInsideOrEqual } from '../../../../../../shared/cross-platform-path'
import { getKnownExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { findKnownWorktreeById } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import {
  selectWorktreesByRepo,
  selectFolderWorkspaces,
  selectDetectedWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import {
  isUnresolvedOwnerHostId,
  parseExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../../../shared/execution-host'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import {
  floatingWorkspaceToWorktree,
  isFloatingWorkspaceId
} from '../../../../../../shared/floating-workspace-worktree'
import { createNativeChatTabOwnerSelector } from '../../pane/ownership/native-chat-tab-owner'
import { FILE_LINK_CONTEXT_INPUT_KEYS } from '../../links/actions/native-chat-file-link-context'
import { resolveNativeChatTabDirectory } from '../../pane/routing/native-chat-tab-directory'
import type { AppState } from '@/store/types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { NativeChatStructuredComposerTransport } from '../submit/native-chat-structured-composer-transport'

const OWNER_CONTEXT_INPUT_KEYS = FILE_LINK_CONTEXT_INPUT_KEYS.filter(
  (key) =>
    key !== 'settings' &&
    key !== 'runtimeEnvironments' &&
    key !== 'activeWorktreeId' &&
    key !== 'activeWorkspaceExecutionHostId'
)

export type NativeChatComposerWorkspaceTarget = Pick<
  NativeChatStructuredComposerTransport,
  'worktreeId' | 'runtimeEnvironmentId' | 'sessionPlace'
>

type ComposerWorkspacePresentation = {
  worktreeId?: string
  repoId?: string
  hostId?: ExecutionHostId
  machine?: string
  checkout?: string
  kind?: 'folder' | 'main' | 'worktree'
  path?: string
  branch?: string
  head?: string
}

const NOTHING_KNOWN: ComposerWorkspacePresentation = {}

export function createNativeChatComposerWorkspaceSelector(
  tabId: string,
  target?: NativeChatComposerWorkspaceTarget
) {
  const selectOwner = createNativeChatTabOwnerSelector(tabId)
  let unifiedBucket: ReturnType<typeof workspaceTabs>
  let tabHost: ExecutionHostId | undefined
  let inputs: unknown[] | undefined
  let context: ComposerWorkspaceContext = {}
  let runtimeSource: AppState['runtimeEnvironments']
  let runtimeIds: string[] = []
  const selectMachine = createComposerMachineSelector(!target)
  const place = target?.sessionPlace
  let presentation: ComposerWorkspacePresentation = {}
  return (state: AppState) => {
    if (place === null) {
      return NOTHING_KNOWN
    }
    // The tab of a session Seal does not host may sit in any workspace: only its record places it.
    const worktreeId = place ? place.worktreeId : (target?.worktreeId ?? selectOwner(state))
    const unified = worktreeId ? workspaceTabs(state.unifiedTabsByWorktree, worktreeId) : undefined
    if (unifiedBucket !== unified) {
      tabHost = unified?.find((tab) => tab.id === tabId)?.executionHostId
      unifiedBucket = unified
    }
    // A structured chat runs on a paired server or this computer, so its null environment is this host.
    const explicitHost = place
      ? place.executionHostId
      : target
        ? target.runtimeEnvironmentId
          ? toRuntimeExecutionHostId(target.runtimeEnvironmentId)
          : 'local'
        : tabHost
    const catalog = {
      repos: state.repos,
      projectGroups: state.projectGroups,
      worktreesByRepo: selectWorktreesByRepo(state),
      folderWorkspaces: selectFolderWorkspaces(state),
      detectedWorktreesByRepo: selectDetectedWorktreesByRepo(state),
      floatingWorkspacePath: state.floatingWorkspacePath
    }
    if (!explicitHost && runtimeSource !== state.runtimeEnvironments) {
      runtimeSource = state.runtimeEnvironments
      const ids = runtimeSource.map((entry) => entry.id)
      if (ids.length !== runtimeIds.length || ids.some((id, index) => id !== runtimeIds[index])) {
        runtimeIds = ids
      }
    }
    const next = [
      worktreeId,
      explicitHost,
      unified,
      state.structuredSessionLaunchDirectoryByTabId[tabId],
      ...Object.values(catalog),
      // Names and connection status cannot change a chat's catalog address.
      ...(explicitHost
        ? []
        : [
            state.activeWorktreeId === worktreeId ? state.activeWorkspaceExecutionHostId : null,
            runtimeIds,
            ...OWNER_CONTEXT_INPUT_KEYS.map((key) => state[key])
          ])
    ]
    if (!inputs || next.some((input, index) => input !== inputs?.[index])) {
      inputs = next
      const host = explicitHost ?? getKnownExecutionHostIdForWorktree(state, worktreeId)
      const directory = place
        ? place.cwd
        : worktreeId
          ? resolveNativeChatTabDirectory(state, tabId, worktreeId, host)
          : null
      const known =
        worktreeId && (place || directory)
          ? isFloatingWorkspaceId(worktreeId)
            ? directory
              ? floatingWorkspaceToWorktree(directory)
              : undefined
            : findKnownWorktreeById(catalog, worktreeId, host ?? undefined)
          : undefined
      // A linked workspace that does not hold the session's cwd says nothing about its checkout.
      const row =
        known && place?.cwd && !isPathInsideOrEqual(known.path, place.cwd) ? undefined : known
      const path = directory ?? row?.path
      const repo = row
        ? findIndexedRepoOwnerForHost(state.repos, row.repoId, host ?? 'local')
        : undefined
      context = {
        host: host && !isUnresolvedOwnerHostId(host) ? host : undefined,
        row,
        repo,
        path: path ?? undefined
      }
      presentation = {
        worktreeId: row?.id,
        repoId: repo?.id,
        checkout: row?.displayName ?? place?.project ?? undefined,
        kind: row
          ? (repo && isFolderRepo(repo)) ||
            parseWorkspaceKey(row.id)?.type === 'folder' ||
            isFloatingWorkspaceId(row.id)
            ? 'folder'
            : row.isMainWorktree
              ? 'main'
              : 'worktree'
          : undefined,
        path: path ?? undefined,
        branch: row?.branch,
        head: row?.head
      }
    }
    const machine =
      place && context.host !== 'local' ? place.machine : selectMachine(state, context)
    if (presentation.hostId !== context.host || presentation.machine !== machine) {
      presentation = { ...presentation, hostId: context.host, machine }
    }
    return presentation
  }
}

type ComposerWorkspaceContext = {
  host?: ExecutionHostId
  row?: ReturnType<typeof findKnownWorktreeById>
  repo?: Repo | null
  path?: string
}

function createComposerMachineSelector(terminalBacked: boolean) {
  let runtimeSource: AppState['runtimeEnvironments']
  let environmentHost: ExecutionHostId | undefined
  let environment: AppState['runtimeEnvironments'][number] | undefined
  let machineInputs: unknown[] | undefined
  let machine: string | undefined
  return (state: AppState, context: ComposerWorkspaceContext): string | undefined => {
    const { host, row, repo, path } = context
    const parsed = host ? parseExecutionHostId(host) : null
    if (runtimeSource !== state.runtimeEnvironments || environmentHost !== host) {
      runtimeSource = state.runtimeEnvironments
      environmentHost = host
      environment =
        parsed?.kind === 'runtime'
          ? runtimeSource.find((entry) => entry.id === parsed.environmentId)
          : undefined
    }
    const override = host ? getHostSettingOverride(state.settings, host, 'displayLabel') : undefined
    const label =
      host && parsed?.kind === 'ssh'
        ? selectExecutionHostDisplayLabel(state, host, {
            sshEnvironmentId: row?.runtimeOwnerEnvironmentId
          })
        : undefined
    const localRuntime = host === 'local' && terminalBacked
    const nextMachine = [
      context,
      override,
      label,
      environment,
      host === 'local' ? state.settings?.machineName : undefined,
      ...(localRuntime
        ? [
            state.projects,
            state.settings?.localWindowsRuntimeDefault,
            state.settings?.localAgentRuntime,
            state.settings?.localAgentWslDistro,
            state.settings?.terminalWindowsShell,
            state.settings?.terminalWindowsWslDistro
          ]
        : [])
    ]
    if (!machineInputs || nextMachine.some((input, index) => input !== machineInputs?.[index])) {
      machineInputs = nextMachine
      const distro =
        host && parsed?.kind === 'runtime'
          ? selectWslHostDistro({ runtimeEnvironments: environment ? [environment] : [] }, host)
          : localRuntime
            ? row && repo && path && !isFloatingWorkspaceId(row.id)
              ? resolvePaneWslDistro(state, row.id, path, { worktree: row, repo })
              : getWslDistroFromPath(path)
            : null
      machine =
        distro ??
        override ??
        (host === 'local'
          ? state.settings?.machineName
          : (label ??
            (host
              ? selectExecutionHostDisplayLabel(
                  { ...state, runtimeEnvironments: environment ? [environment] : [] },
                  host
                )
              : undefined)))
    }
    return machine
  }
}
