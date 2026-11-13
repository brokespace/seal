import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** A list on disk: whole-file JSON, written atomically and in order, readable by the user only. */
export class LiveSessionJsonStore<T> {
  private saving: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly isItem: (item: unknown) => item is T,
    private readonly log?: (message: string, error?: unknown) => void
  ) {}

  async load(): Promise<T[]> {
    try {
      const list: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      return (Array.isArray(list) ? list : []).filter(this.isItem)
    } catch {
      // Nothing saved yet, or an unreadable file: start empty.
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
      .catch((error) => this.log?.(`[live-sessions] saving ${this.path} failed`, error))
  }

  /** Resolves once everything saved so far is on disk. */
  flush(): Promise<void> {
    return this.saving
  }
}
