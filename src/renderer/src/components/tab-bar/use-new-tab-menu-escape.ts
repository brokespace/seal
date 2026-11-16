import { useRef } from 'react'

/** Remembers that Esc closed the new-tab menu, so its close can leave the keyboard on the "+". */
export function useNewTabMenuEscape(): {
  noteNewTabMenuEscape: () => void
  takeNewTabMenuEscape: () => boolean
} {
  const escapedRef = useRef(false)
  const handlersRef = useRef({
    noteNewTabMenuEscape: (): void => {
      escapedRef.current = true
    },
    takeNewTabMenuEscape: (): boolean => {
      const escaped = escapedRef.current
      escapedRef.current = false
      return escaped
    }
  })
  return handlersRef.current
}
