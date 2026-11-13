import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The outbox on disk: whole-file JSON, written atomically and in order, readable by the user only. */
export class LiveMessageStore<T extends { messageId: string; sessionId: string }> {
  private saving: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly log?: (message: string, error?: unknown) => void
  ) {}

  async load(): Promise<T[]> {
    try {
      const list = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      return (Array.isArray(list) ? list : []).filter(
        (item): item is T =>
          !!item && typeof item.messageId === 'string' && typeof item.sessionId === 'string'
      )
    } catch {
      // No outbox yet, or an unreadable one: start empty.
      return []
    }
  }

  save(items: T[]): void {
    const data = JSON.stringify(items)
    this.saving = this.saving
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true })
        await writeFile(`${this.path}.tmp`, data, { mode: 0o600 })
        await rename(`${this.path}.tmp`, this.path)
      })
      .catch((error) => this.log?.('[live-sessions] saving the outbox failed', error))
  }

  /** Resolves once everything saved so far is on disk. */
  flush(): Promise<void> {
    return this.saving
  }
}
