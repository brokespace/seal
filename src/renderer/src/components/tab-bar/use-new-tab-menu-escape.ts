import { useCallback, useRef } from 'react'

/** Remembers that Esc closed the new-tab menu, so its close can leave the keyboard on the "+". */
export function useNewTabMenuEscape(): {
  noteNewTabMenuEscape: () => void
  takeNewTabMenuEscape: () => boolean
} {
  const escapedRef = useRef(false)
  const noteNewTabMenuEscape = useCallback((): void => {
    escapedRef.current = true
  }, [])
  const takeNewTabMenuEscape = useCallback((): boolean => {
    const escaped = escapedRef.current
    escapedRef.current = false
    return escaped
  }, [])
  return { noteNewTabMenuEscape, takeNewTabMenuEscape }
}
