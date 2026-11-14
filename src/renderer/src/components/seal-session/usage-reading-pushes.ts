import { useAppStore } from '../../store'

/** Readings arrive in bursts (fetching, then each account); one re-read after they settle is enough. */
const SETTLE_MS = 400

/**
 * Runs `listener` shortly after the rate-limit service pushes usage. Seal's account status is
 * built from those same readings, so views of it re-read then rather than trail the usage
 * popover until their next poll.
 */
export function onUsageReadingPushed(listener: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = useAppStore.subscribe((state, previous) => {
    if (state.rateLimits === previous.rateLimits) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(listener, SETTLE_MS)
  })
  return () => {
    clearTimeout(timer)
    stop()
  }
}
