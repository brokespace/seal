import { useCallback, useState } from 'react'

const STORAGE_KEY = 'seal.home-chat.minimized.v1'

export function loadHomeChatMinimized(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveHomeChatMinimized(minimized: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(minimized))
  } catch {
    // The chat still collapses for this session when device storage is full.
  }
}

/** Whether Home's chat is collapsed to its title bar; remembered on this device across restarts. */
export function useHomeChatMinimized(): [boolean, (minimized: boolean) => void] {
  const [minimized, setMinimized] = useState(loadHomeChatMinimized)
  const update = useCallback((next: boolean) => {
    setMinimized(next)
    saveHomeChatMinimized(next)
  }, [])
  return [minimized, update]
}
