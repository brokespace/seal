import type { RateLimitService } from '../rate-limits/service/rate-limit-service'

const INACTIVE_REFRESH_MS = 5 * 60_000

/**
 * Keeps usage fresh while auto-swap is on, even with no window open: holds a usage viewer for
 * the active accounts and re-reads inactive accounts on a timer that stops when auto-swap does.
 */
export class SealUsageWatch {
  private releaseViewer: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private wanted = false

  constructor(
    private readonly rateLimits: Pick<RateLimitService, 'addUsageViewer'>,
    private readonly refresh: () => Promise<void>,
    private readonly onRefreshed: () => void
  ) {}

  sync(wanted: boolean): void {
    this.wanted = wanted
    if (wanted && !this.releaseViewer) {
      this.releaseViewer = this.rateLimits.addUsageViewer()
    } else if (!wanted && this.releaseViewer) {
      this.releaseViewer()
      this.releaseViewer = null
    }
    if (wanted) {
      this.schedule()
    } else {
      this.clearTimer()
    }
  }

  dispose(): void {
    this.sync(false)
  }

  private clearTimer(): void {
    clearTimeout(this.timer ?? undefined)
    this.timer = null
  }

  private schedule(): void {
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.wanted) {
        return
      }
      void this.refresh().finally(() => {
        if (this.wanted) {
          this.onRefreshed()
          this.schedule()
        }
      })
    }, INACTIVE_REFRESH_MS)
    this.timer.unref?.()
  }
}
