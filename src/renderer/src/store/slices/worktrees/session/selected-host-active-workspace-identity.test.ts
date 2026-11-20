import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { useAppStore } from '@/store/index'

const SAME_REPO_ID = 'same-repo'
const SAME_WORKTREE_ID = 'same-worktree'
const RUNTIME_HOST: ExecutionHostId = 'runtime:env-1'

function worktree(path: string, hostId: ExecutionHostId): Worktree {
  return {
    id: SAME_WORKTREE_ID,
    repoId: SAME_REPO_ID,
    path,
    displayName: path,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    head: 'abc',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree: true,
    hostId
  }
}

afterEach(() => {
  useAppStore.setState({
    repos: [],
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    projectGroups: [],
    folderWorkspaces: [],
    activeRepoId: null,
    activeWorktreeId: null,
    activeWorkspaceKey: null,
    activeWorkspaceExecutionHostId: null
  } as never)
})

describe('selected-host active workspace identity', () => {
  it('selects the runtime worktree when exact IDs collide in local-first order', () => {
    const local = worktree('/local/repo', 'local')
    const runtime = worktree('/runtime/repo', RUNTIME_HOST)
    useAppStore.setState({
      repos: [
        {
          id: SAME_REPO_ID,
          path: local.path,
          displayName: 'local',
          badgeColor: '#000',
          addedAt: 1,
          executionHostId: 'local'
        },
        {
          id: SAME_REPO_ID,
          path: runtime.path,
          displayName: 'runtime',
          badgeColor: '#000',
          addedAt: 2,
          executionHostId: RUNTIME_HOST
        }
      ],
      worktreesByRepo: { [SAME_REPO_ID]: [local, runtime] },
      refreshGitHubForWorktreeIfStale: () => undefined
    })

    const selected = useAppStore.getState().getKnownWorktreeById(SAME_WORKTREE_ID, RUNTIME_HOST)
    expect(selected?.path).toBe(runtime.path)

    useAppStore.getState().setActiveWorktree(SAME_WORKTREE_ID, RUNTIME_HOST)
    const state = useAppStore.getState()
    expect(state.activeWorkspaceExecutionHostId).toBe(RUNTIME_HOST)
    expect(getExecutionHostIdForWorktree(state, SAME_WORKTREE_ID)).toBe(RUNTIME_HOST)
  })

  // The Files tab reads the selection; reopening a same-id workspace must follow its shown chat's machine.
  it('selects the copy the shown tab runs on when activation names no host', () => {
    const local = worktree('/same/repo', 'local')
    const runtime = worktree('/same/repo', RUNTIME_HOST)
    useAppStore.setState({
      repos: [
        {
          id: SAME_REPO_ID,
          path: local.path,
          displayName: 'local',
          badgeColor: '#000',
          addedAt: 1,
          executionHostId: 'local'
        },
        {
          id: SAME_REPO_ID,
          path: runtime.path,
          displayName: 'runtime',
          badgeColor: '#000',
          addedAt: 2,
          executionHostId: RUNTIME_HOST
        }
      ],
      worktreesByRepo: { [SAME_REPO_ID]: [local, runtime] },
      unifiedTabsByWorktree: {
        [SAME_WORKTREE_ID]: [
          {
            id: 'chat-on-runtime',
            entityId: 'chat-on-runtime',
            groupId: 'group-1',
            worktreeId: SAME_WORKTREE_ID,
            executionHostId: RUNTIME_HOST,
            contentType: 'agent-session',
            label: 'chat',
            customLabel: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          }
        ]
      },
      groupsByWorktree: {
        [SAME_WORKTREE_ID]: [
          {
            id: 'group-1',
            worktreeId: SAME_WORKTREE_ID,
            activeTabId: 'chat-on-runtime',
            tabOrder: ['chat-on-runtime']
          }
        ]
      },
      activeGroupIdByWorktree: { [SAME_WORKTREE_ID]: 'group-1' },
      refreshGitHubForWorktreeIfStale: () => undefined
    })

    useAppStore.getState().setActiveWorktree(SAME_WORKTREE_ID)
    expect(useAppStore.getState().activeWorkspaceExecutionHostId).toBe(RUNTIME_HOST)
  })
})
