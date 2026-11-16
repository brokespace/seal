import { createContext, useContext, useMemo } from 'react'
import { useAppStore } from '@/store/index'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'

export type FileExplorerProps = {
  /** The workspace to list; omitted follows the active workspace. */
  worktreeId?: string | null
  /** The host listing `worktreeId` when other hosts repeat the id; omitted takes the selected copy. */
  executionHostId?: ExecutionHostId | null
  /** Mounted outside the right sidebar: on screen while mounted, Files view only. */
  embedded?: boolean
}

export type FileExplorerMount = {
  worktreeId: string | null
  executionHostId: ExecutionHostId | undefined
  embedded: boolean
}

const RIGHT_SIDEBAR_MOUNT: FileExplorerMount = {
  worktreeId: null,
  executionHostId: undefined,
  embedded: false
}

export const FileExplorerMountContext = createContext(RIGHT_SIDEBAR_MOUNT)

export function useFileExplorerMountFor(props: FileExplorerProps): FileExplorerMount {
  const worktreeId = props.worktreeId ?? null
  const executionHostId = props.executionHostId ?? undefined
  const embedded = props.embedded ?? false
  return useMemo(
    () => ({ worktreeId, executionHostId, embedded }),
    [worktreeId, executionHostId, embedded]
  )
}

export function useFileExplorerMount(): FileExplorerMount {
  return useContext(FileExplorerMountContext)
}

export function useFileExplorerWorktreeId(): string | null {
  const { worktreeId } = useContext(FileExplorerMountContext)
  return useAppStore((s) => worktreeId ?? s.activeWorktreeId)
}
