/** Ended sessions come by the hundred at launch, some on slow machines: this many of their folders are asked about at once. */
const ASKED_AT_ONCE = 4

/** Asks what repository folders are in, a few at a time: an answered folder never again, an unread one only after a wait. */
export class RepositoryIdentification {
  /** When a folder may next be asked: never while it is being asked or once it has answered. */
  private readonly askAfter = new Map<string, number>()
  private readonly waiting = new Map<string, () => Promise<boolean>>()
  private asking = 0

  constructor(
    private readonly deps: {
      retryMs: number
      now: () => number
      log?: (message: string, error?: unknown) => void
    }
  ) {}

  /** `ask` resolves false for a folder that could not be read. */
  request(key: string, ask: () => Promise<boolean>): void {
    if (this.deps.now() < (this.askAfter.get(key) ?? 0)) {
      return
    }
    if (this.asking >= ASKED_AT_ONCE) {
      this.waiting.set(key, ask)
      return
    }
    this.asking += 1
    this.askAfter.set(key, Infinity)
    void ask()
      .catch((error: unknown) => {
        this.deps.log?.('[live-sessions] a folder was not asked for its repository', error)
        return false
      })
      .then((answered) => {
        this.asking -= 1
        const now = this.deps.now()
        for (const [passed, at] of this.askAfter) {
          if (now >= at) {
            this.askAfter.delete(passed)
          }
        }
        if (!answered) {
          this.askAfter.set(key, now + this.deps.retryMs)
        }
        for (const [next, waited] of this.waiting) {
          if (this.asking >= ASKED_AT_ONCE) {
            break
          }
          this.waiting.delete(next)
          this.request(next, waited)
        }
      })
  }
}
