import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** A file under `~/.config/seal`: how a headless Seal server is set up with no Settings UI. */
export function sealConfigFilePath(name: string): string {
  return join(homedir(), '.config', 'seal', name)
}

/** One JSON config file, read again only when it changes. Its contents are never logged. */
export class SealConfigFile {
  private file: { mtimeMs: number; value: unknown } | null = null
  private warnedUnreadable = false

  constructor(
    private readonly path: string,
    /** The file's subject in the one warning an unreadable file gets. */
    private readonly label: string
  ) {}

  /** The parsed file; null when it is absent or not JSON. */
  async read(): Promise<unknown> {
    let mtimeMs: number
    try {
      mtimeMs = (await stat(this.path)).mtimeMs
    } catch {
      this.file = null
      return null
    }
    if (this.file?.mtimeMs === mtimeMs) {
      return this.file.value
    }
    try {
      this.file = { mtimeMs, value: JSON.parse(await readFile(this.path, 'utf8')) }
      this.warnedUnreadable = false
    } catch {
      this.file = { mtimeMs, value: null }
      if (!this.warnedUnreadable) {
        this.warnedUnreadable = true
        // A JSON parse error quotes the text it choked on, so the error itself is never logged.
        console.warn(
          `[utility-model] the ${this.label} config file is not readable JSON; ignoring it`
        )
      }
    }
    return this.file.value
  }
}
