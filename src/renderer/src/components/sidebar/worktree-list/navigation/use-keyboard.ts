import { textFieldClaimsActionKey } from '@/lib/keyboard/text-field-shortcut-policy'
import React, { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { hasVisibleOverlay } from '@/lib/overlay-interaction/visible-overlay'
import { getWorktreeExecutionHostId } from '../../../../../../shared/execution-host'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { getShortcutPlatform } from '@/lib/keyboard/shortcut-platform'
import { keybindingMatchesAction } from '../../../../../../shared/keybindings'
import type { HostSectionRow } from '../../../../../../shared/sidebar-list/hosts/host-section-rows'
import type { PinnedWorktreeDisplayPolicy } from '../../../../../../shared/sidebar-list/row-types'
import type { LastActiveCycleWorkspace } from './worktree-keyboard-cycle'
import { resolveCycledWorkspaceStep } from './worktree-keyboard-cycle'
import { getRenderedWorkspaceRowsInSidebarOrder } from './worktree-sidebar-row-preference'
import { useWorkspaceKeyboardPreview } from './use-workspace-keyboard-preview'
import {
  offerSidebarSectionKeyboardCursor,
  useSidebarSectionKeyboardEntry
} from '../../sidebar-section-keyboard-handoff'
import { addAppKeyListener, removeAppKeyListener } from '@/lib/keyboard/app-keyboard-router'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { focusActiveWorkspaceSurfaceFromSidebar } from './focus-workspace-surface'
import type { WorktreeContextMenuDeleteIntent } from '../../workspace-actions/context-menu/worktree-context-menu-delete-intent'
import { useSidebarWorkspaceDeleteKeyboard } from './use-sidebar-workspace-delete-keyboard'
import { textInputOwnsComposition } from '../../../../../../shared/text-input-shortcut-policy'
import { useWorkspaceNeighborPrewarm } from './use-neighbor-prewarm'

export { withKeyboardPreview } from './worktree-keyboard-cycle'

function getWorktreeRowsSection(list: HTMLElement | null): Element | null {
  return list?.querySelector('[data-worktree-sidebar-content]') ?? null
}

export function useWorktreeListKeyboardNavigation(args: {
  rows: HostSectionRow[]
  activeWorktreeId: string | null
  activeWorkspaceExecutionHostId: ExecutionHostId | null
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
  scrollRef: React.RefObject<HTMLDivElement | null>
  activeModal: string
  markDirectScrollInput: () => void
  onKeyboardSelect?: (worktree: Worktree) => void
  focusedWorktree?: Worktree | null
  focusedWorkspaceExecutionHostId?: ExecutionHostId | null
  resolveDeleteIntent?: () => WorktreeContextMenuDeleteIntent | null
}) {
  const {
    rows,
    activeWorktreeId,
    activeWorkspaceExecutionHostId,
    pinnedDisplayPolicy,
    scrollRef,
    activeModal,
    markDirectScrollInput,
    onKeyboardSelect,
    focusedWorktree,
    focusedWorkspaceExecutionHostId,
    resolveDeleteIntent
  } = args
  const keybindings = useAppStore((s) => s.keybindings)
  useWorkspaceNeighborPrewarm({
    rows,
    pinnedDisplayPolicy,
    activeWorktreeId,
    activeWorkspaceExecutionHostId
  })
  const lastActiveWorkspaceRef = useRef<LastActiveCycleWorkspace | null>(null)
  useEffect(() => {
    // Closing the last tab clears both selection and host; history retains only the id.
    if (activeWorktreeId !== null) {
      lastActiveWorkspaceRef.current = {
        worktreeId: activeWorktreeId,
        executionHostId: activeWorkspaceExecutionHostId
      }
    }
  }, [activeWorktreeId, activeWorkspaceExecutionHostId])

  const { previewRef, keyboardPreview, dropPreview, commitPreview, goToRow } =
    useWorkspaceKeyboardPreview({ activeWorktreeId, onKeyboardSelect })
  const { handleDeleteKeyDown, handleContainerKeyUp, resetDeleteGesture } =
    useSidebarWorkspaceDeleteKeyboard({ keybindings, resolveDeleteIntent, dropPreview })

  const navigateWorktree = useCallback(
    (direction: 'up' | 'down', isRepeat: boolean, selectInList = false) => {
      const { worktreeNavHistory, worktreeNavHistoryIndex } = useAppStore.getState()
      const previewState = previewRef.current
      const preview =
        previewState && previewState.fromWorktreeId === activeWorktreeId ? previewState.row : null
      const focused = selectInList ? focusedWorktree : null
      // Cycle actual rendered rows so collapse, pins, hosts and folder workspaces stay aligned with the screen.
      const step = resolveCycledWorkspaceStep({
        rows,
        pinnedDisplayPolicy,
        activeWorktreeId: preview?.worktree.id ?? focused?.id ?? activeWorktreeId,
        activeWorkspaceExecutionHostId: preview
          ? getWorktreeExecutionHostId(preview.worktree, preview.repo)
          : focused
            ? (focusedWorkspaceExecutionHostId ?? null)
            : activeWorkspaceExecutionHostId,
        lastActiveWorkspace: lastActiveWorkspaceRef.current,
        navHistory: worktreeNavHistory,
        navHistoryIndex: worktreeNavHistoryIndex,
        direction
      })
      if (!step) {
        return
      }
      // In the list, the first and last rows lead on to the neighbouring sidebar section before wrapping around.
      if (
        selectInList &&
        step.wrapped &&
        offerSidebarSectionKeyboardCursor(getWorktreeRowsSection(scrollRef.current), direction)
      ) {
        // A held key switches only where it stops, and it left these rows: a later switch would pull focus into the terminal.
        dropPreview()
        return
      }
      goToRow(step.row, isRepeat, selectInList)
    },
    [
      rows,
      activeWorktreeId,
      activeWorkspaceExecutionHostId,
      pinnedDisplayPolicy,
      focusedWorktree,
      focusedWorkspaceExecutionHostId,
      dropPreview,
      goToRow,
      previewRef,
      scrollRef
    ]
  )

  // Arrow keys run through the whole sidebar list: a neighbouring section hands the cursor to these rows.
  useSidebarSectionKeyboardEntry(
    () => getWorktreeRowsSection(scrollRef.current),
    (edge) => {
      const list = scrollRef.current
      const ordered = getRenderedWorkspaceRowsInSidebarOrder(rows, pinnedDisplayPolicy)
      const row = edge === 'first' ? ordered[0] : ordered.at(-1)
      if (!list || !row || activeModal !== 'none') {
        return false
      }
      list.focus({ preventScroll: true })
      list.setAttribute('data-keyboard-navigation', '')
      markDirectScrollInput()
      goToRow(row, false, true)
      return true
    }
  )

  useEffect(() => {
    const endListNavigation = () => {
      scrollRef.current?.removeAttribute('data-keyboard-navigation')
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || activeModal !== 'none') {
        return
      }

      const platform = getShortcutPlatform()
      if (
        keybindingMatchesAction('sidebar.focusWorktreeList', e, platform, keybindings) &&
        !textFieldClaimsActionKey(e, 'sidebar.focusWorktreeList') &&
        !hasVisibleOverlay()
      ) {
        scrollRef.current?.focus()
        e.preventDefault()
        return
      }

      const direction = keybindingMatchesAction('worktree.navigateUp', e, platform, keybindings)
        ? 'up'
        : keybindingMatchesAction('worktree.navigateDown', e, platform, keybindings)
          ? 'down'
          : null
      const directionAction = direction === 'up' ? 'worktree.navigateUp' : 'worktree.navigateDown'
      if (direction && !textFieldClaimsActionKey(e, directionAction) && !hasVisibleOverlay()) {
        endListNavigation()
        markDirectScrollInput()
        navigateWorktree(direction, e.repeat)
        e.preventDefault()
        // Why: a user-bound chord fired from a field must not also reach the field's own handler.
        e.stopPropagation()
      }
    }

    const handleKeyUp = () => {
      if (previewRef.current !== null) {
        commitPreview()
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && scrollRef.current?.contains(event.target))) {
        endListNavigation()
      }
      resetDeleteGesture()
      dropPreview()
    }
    const handleFocusOut = (event: FocusEvent) => {
      if (event.target === scrollRef.current) {
        endListNavigation()
        resetDeleteGesture()
      }
    }
    const handleBlur = () => {
      endListNavigation()
      resetDeleteGesture()
    }

    addAppKeyListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('focusout', handleFocusOut, { capture: true })
    window.addEventListener('blur', handleBlur)
    return () => {
      removeAppKeyListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('focusout', handleFocusOut, { capture: true })
      window.removeEventListener('blur', handleBlur)
      resetDeleteGesture()
    }
  }, [
    activeModal,
    commitPreview,
    dropPreview,
    keybindings,
    markDirectScrollInput,
    navigateWorktree,
    previewRef,
    scrollRef,
    resetDeleteGesture
  ])

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (textInputOwnsComposition(e.nativeEvent)) {
        resetDeleteGesture()
        return
      }
      if (
        e.defaultPrevented ||
        e.target !== e.currentTarget ||
        activeModal !== 'none' ||
        hasVisibleOverlay()
      ) {
        return
      }
      if (handleDeleteKeyDown(e)) {
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // The focused DOM node owns navigation, including while a new terminal mounts.
        e.currentTarget.setAttribute('data-keyboard-navigation', '')
        markDirectScrollInput()
        navigateWorktree(e.key === 'ArrowUp' ? 'up' : 'down', e.repeat, true)
        e.preventDefault()
      } else if (e.key === 'Enter') {
        if (previewRef.current !== null) {
          commitPreview()
        }
        focusActiveWorkspaceSurfaceFromSidebar(e.currentTarget)
        e.preventDefault()
      } else if (['PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        markDirectScrollInput()
      }
    },
    [
      activeModal,
      commitPreview,
      handleDeleteKeyDown,
      resetDeleteGesture,
      markDirectScrollInput,
      navigateWorktree,
      previewRef
    ]
  )

  return {
    handleContainerKeyDown,
    handleContainerKeyUp,
    handleContainerBlur: resetDeleteGesture,
    keyboardPreview
  }
}
