import { useEffect, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

/** The time, refreshed while the window is visible, for "5m ago" labels. */
export function useLiveSessionClock(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    return installWindowVisibilityInterval({ run: () => setNow(Date.now()), intervalMs: everyMs })
  }, [everyMs])
  return now
}
