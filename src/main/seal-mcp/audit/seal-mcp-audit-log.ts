import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SealMcpAuditEntry } from '../../../shared/seal-mcp/seal-mcp-types'

const DEFAULT_KEEP = 5_000

export type SealMcpAuditQuery = { clientId?: string; limit?: number; before?: number }

function isEntry(value: unknown): value is SealMcpAuditEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'at' in value &&
    typeof value.at === 'number' &&
    'outcome' in value &&
    typeof value.outcome === 'string'
  )
}

/**
 * Every MCP request, newest last, in a JSON-lines file only the user can read. The file is cut
 * back to the newest `keep` entries when it has grown to twice that.
 */
export class SealMcpAuditLog {
  private entries: SealMcpAuditEntry[] = []
  private linesOnDisk = 0
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly onEntry: (entry: SealMcpAuditEntry) => void = () => {},
    private readonly keep = DEFAULT_KEEP
  ) {}

  async load(): Promise<void> {
    try {
      const lines = (await readFile(this.path, 'utf8')).split('\n').filter(Boolean)
      this.linesOnDisk = lines.length
      this.entries = lines.slice(-this.keep).flatMap((line) => {
        try {
          const parsed: unknown = JSON.parse(line)
          return isEntry(parsed) ? [parsed] : []
        } catch {
          // A torn last line from a crash is dropped; the rest of the log stands.
          return []
        }
      })
    } catch {
      // No log yet.
    }
  }

  record(entry: Omit<SealMcpAuditEntry, 'id' | 'at'>): SealMcpAuditEntry {
    const stored: SealMcpAuditEntry = { ...entry, id: randomUUID(), at: Date.now() }
    this.entries.push(stored)
    if (this.entries.length > this.keep) {
      this.entries = this.entries.slice(-this.keep)
    }
    this.linesOnDisk += 1
    const compact = this.linesOnDisk >= this.keep * 2
    if (compact) {
      this.linesOnDisk = this.entries.length
    }
    const snapshot = compact ? this.entries.map((item) => JSON.stringify(item)).join('\n') : null
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
        if (snapshot !== null) {
          await writeFile(`${this.path}.tmp`, `${snapshot}\n`, { mode: 0o600 })
          await rename(`${this.path}.tmp`, this.path)
          return
        }
        await appendFile(this.path, `${JSON.stringify(stored)}\n`, { mode: 0o600 })
      })
      .catch((error: unknown) => console.warn('[mcp] writing the audit log failed:', error))
    this.onEntry(stored)
    return stored
  }

  /** Newest first. */
  list(query: SealMcpAuditQuery = {}): SealMcpAuditEntry[] {
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 1_000)
    const found: SealMcpAuditEntry[] = []
    for (let index = this.entries.length - 1; index >= 0 && found.length < limit; index--) {
      const entry = this.entries[index]
      if (
        (query.clientId === undefined || entry.clientId === query.clientId) &&
        (query.before === undefined || entry.at < query.before)
      ) {
        found.push(entry)
      }
    }
    return found
  }

  /** Resolves once everything recorded so far is on disk. */
  flush(): Promise<void> {
    return this.writing
  }
}
