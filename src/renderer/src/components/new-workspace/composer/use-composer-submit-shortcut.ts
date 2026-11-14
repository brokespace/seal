import { useEffect, type RefObject } from 'react'
import { addAppKeyListener, removeAppKeyListener } from '@/lib/keyboard/app-keyboard-router'
import { isScreenSubmitShortcut } from '@/lib/keyboard/screen-submit-shortcut'
import { shouldAllowComposerEnterSubmitTarget } from '@/lib/workspace/creation/new-workspace-enter-guard'

/** Submits the composer on the screen submit chord; nested dialogs disable it so they own input. */
export function useComposerSubmitShortcut({
  enabled,
  composerRef,
  createDisabled,
  onSubmit
}: {
  enabled: boolean
  composerRef: RefObject<HTMLDivElement | null>
  createDisabled: boolean
  onSubmit: () => Promise<void>
}): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      // Creation uses the screen submit chord, outside configurable app commands.
      if (!isScreenSubmitShortcut(event)) {
        return
      }
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      if (!shouldAllowComposerEnterSubmitTarget(target, composerRef.current)) {
        return
      }
      if (createDisabled || composerRef.current?.hasAttribute('data-sparse-preset-editing')) {
        return
      }
      event.preventDefault()
      void onSubmit()
    }
    addAppKeyListener('keydown', onKeyDown)
    return () => removeAppKeyListener('keydown', onKeyDown)
  }, [enabled, composerRef, createDisabled, onSubmit])
}
