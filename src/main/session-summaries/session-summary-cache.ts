import { LiveSessionJsonStore } from '../live-sessions/live-session-json-store'

type CachedSummary = { session: string; hash: string; text: string; at: number }

const MAX_ENTRIES = 600

function isCachedSummary(item: unknown): item is CachedSummary {
  return (
    typeof item === 'object' &&
    item !== null &&
    'session' in item &&
    typeof item.session === 'string' &&
    'hash' in item &&
    typeof item.hash === 'string' &&
    'text' in item &&
    typeof item.text === 'string' &&
    'at' in item &&
    typeof item.at === 'number'
  )
}

/** Summaries already paid for, by session and message hash; kept across restarts so a restart re-summarizes nothing. */
export class SessionSummaryCache {
  private readonly entries = new Map<string, CachedSummary>()
  private readonly store: LiveSessionJsonStore<CachedSummary> | null

  constructor(path: string | null, log?: (message: string, error?: unknown) => void) {
    this.store = path ? new LiveSessionJsonStore(path, isCachedSummary, log) : null
  }

  async load(): Promise<void> {
    for (const entry of (await this.store?.load()) ?? []) {
      // A summary made while the file was loading is the newer one.
      if (!this.entries.has(this.key(entry.session, entry.hash))) {
        this.entries.set(this.key(entry.session, entry.hash), entry)
      }
    }
  }

  get(session: string, hash: string): string | null {
    return this.entries.get(this.key(session, hash))?.text ?? null
  }

  set(session: string, hash: string, text: string, at: number): void {
    const key = this.key(session, hash)
    this.entries.delete(key)
    this.entries.set(key, { session, hash, text, at })
    while (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!)
    }
    this.store?.save([...this.entries.values()])
  }

  private key(session: string, hash: string): string {
    return `${session}\n${hash}`
  }
}
