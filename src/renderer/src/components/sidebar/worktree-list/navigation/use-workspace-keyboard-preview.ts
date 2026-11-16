import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { activateWorktreeFromSidebar } from '@/lib/workspace/activation/sidebar-worktree-activation'
import { getWorktreeExecutionHostId } from '../../../../../../shared/execution-host/execution-host'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { LastActiveCycleWorkspace, SidebarWorkspacePreview } from './worktree-keyboard-cycle'
import type { RenderedWorkspaceRow } from './worktree-sidebar-row-preference'

const PREVIEW_COMMIT_FIRST_REPEAT_MS = 120
const PREVIEW_COMMIT_MIN_MS = 50
const PREVIEW_COMMIT_MAX_MS = 200

/** Moves the keyboard cursor to a workspace row: a single press switches to it, a held key only previews it. */
export function useWorkspaceKeyboardPreview(args: {
  activeWorktreeId: string | null
  onKeyboardSelect?: (worktree: Worktree) => void
}) {
  const { activeWorktreeId, onKeyboardSelect } = args
  // Held arrows move only the sidebar highlight; the workspace under it switches once the repeat stops.
  // fromWorktreeId: another input switching workspaces mid-hold invalidates the preview, so it never pulls the user back.
  const previewRef = useRef<SidebarWorkspacePreview | null>(null)
  const [keyboardPreview, setKeyboardPreview] = useState<
    (LastActiveCycleWorkspace & { fromWorktreeId: string | null }) | null
  >(null)
  const previewCommitTimerRef = useRef<number | null>(null)
  const lastRepeatAtRef = useRef<number | null>(null)
  const clearPreviewCommitTimer = useCallback(() => {
    if (previewCommitTimerRef.current !== null) {
      window.clearTimeout(previewCommitTimerRef.current)
      previewCommitTimerRef.current = null
    }
  }, [])
  const dropPreview = useCallback(() => {
    clearPreviewCommitTimer()
    lastRepeatAtRef.current = null
    if (previewRef.current !== null) {
      previewRef.current = null
      setKeyboardPreview(null)
    }
  }, [clearPreviewCommitTimer])
  const commitPreview = useCallback(() => {
    const preview = previewRef.current
    dropPreview()
    if (preview && preview.fromWorktreeId === useAppStore.getState().activeWorktreeId) {
      void activateWorktreeFromSidebar(
        preview.row.worktree.id,
        getWorktreeExecutionHostId(preview.row.worktree, preview.row.repo),
        { revealInSidebar: false }
      )
    }
  }, [dropPreview])
  useEffect(() => clearPreviewCommitTimer, [clearPreviewCommitTimer])

  const goToRow = useCallback(
    (nextRow: RenderedWorkspaceRow, isRepeat: boolean, selectInList: boolean) => {
      const nextWorktree = nextRow.worktree
      if (selectInList) {
        onKeyboardSelect?.(nextWorktree)
      }
      const executionHostId = getWorktreeExecutionHostId(nextWorktree, nextRow.repo)
      if (isRepeat) {
        previewRef.current = { row: nextRow, fromWorktreeId: activeWorktreeId }
        setKeyboardPreview({
          worktreeId: nextWorktree.id,
          executionHostId,
          fromWorktreeId: activeWorktreeId
        })
        const now = performance.now()
        const repeatIntervalMs =
          lastRepeatAtRef.current === null ? null : now - lastRepeatAtRef.current
        lastRepeatAtRef.current = now
        clearPreviewCommitTimer()
        // Commit once repeats stop; macOS drops keyup while Cmd is held, so a missed repeat is the stop signal.
        previewCommitTimerRef.current = window.setTimeout(
          commitPreview,
          repeatIntervalMs === null
            ? PREVIEW_COMMIT_FIRST_REPEAT_MS
            : Math.min(
                PREVIEW_COMMIT_MAX_MS,
                Math.max(PREVIEW_COMMIT_MIN_MS, repeatIntervalMs * 1.5)
              )
        )
      } else {
        dropPreview()
        void activateWorktreeFromSidebar(nextWorktree.id, executionHostId, {
          revealInSidebar: false
        })
      }

      useAppStore.getState().revealWorktreeInSidebar(nextWorktree.id, {
        behavior: 'auto',
        executionHostId,
        rowKey: nextRow.rowKey
      })
    },
    [activeWorktreeId, onKeyboardSelect, clearPreviewCommitTimer, commitPreview, dropPreview]
  )

  return {
    previewRef,
    keyboardPreview: keyboardPreview?.fromWorktreeId === activeWorktreeId ? keyboardPreview : null,
    dropPreview,
    commitPreview,
    goToRow
  }
}
