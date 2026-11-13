import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { buildDiscoveryScript } from './discovery-script'
import { parseDiscoveryOutput, type DiscoveredFile } from './discovery-output'
import { assembleHostSessions, type SummarizedTranscript } from './session-assembly'
import { summarizeClaudeTranscript, summarizeCodexRollout } from './transcript-summary'

export type HostScanLimits = {
  maxAgeMinutes: number
  maxFiles: number
  maxReads: number
  headBytes: number
  tailBytes: number
}

export const LOCAL_SCAN_LIMITS: HostScanLimits = {
  maxAgeMinutes: 12 * 60,
  maxFiles: 60,
  maxReads: 60,
  headBytes: 16 * 1024,
  tailBytes: 48 * 1024
}

// SSH exec keeps only the last 1 MB of output; a handful of reads stays well under it.
export const SSH_SCAN_LIMITS: HostScanLimits = { ...LOCAL_SCAN_LIMITS, maxFiles: 40, maxReads: 6 }

type CachedTranscript = SummarizedTranscript & { head: string | null }

export type HostScanResult = { sessions: LiveSession[]; complete: boolean }

/** Scans one host, re-reading only transcripts that grew since the last scan. */
export class HostSessionScanner {
  private readonly cache = new Map<string, CachedTranscript>()
  private readonly firstSeen = new Map<string, number>()

  constructor(
    private readonly host: LiveSessionHost,
    private readonly limits: HostScanLimits,
    private readonly extraRoots: () => { claudeProjectsDirs: string[]; codexSessionsDirs: string[] }
  ) {}

  async scan(nowMs: number): Promise<HostScanResult> {
    const script = buildDiscoveryScript({
      ...this.limits,
      ...this.extraRoots(),
      known: [...this.cache.values()].map((t) => ({ path: t.path, size: t.size })),
      headKnown: [...this.cache.values()].filter((t) => t.head !== null).map((t) => t.path)
    })
    const output = parseDiscoveryOutput(await this.host.run(script))
    const listed = new Set(output.files.map((f) => f.path))
    for (const file of output.files) {
      this.absorb(file)
    }
    if (output.complete) {
      for (const path of this.cache.keys()) {
        if (!listed.has(path)) {
          this.cache.delete(path)
        }
      }
    }
    const transcripts = [...this.cache.values()].filter((t) => listed.has(t.path))
    const sessions = assembleHostSessions({
      machine: this.host.machine,
      output,
      transcripts,
      nowMs
    })
    const ids = new Set(sessions.map((s) => s.id))
    for (const id of this.firstSeen.keys()) {
      if (!ids.has(id)) {
        this.firstSeen.delete(id)
      }
    }
    for (const session of sessions) {
      const seen = this.firstSeen.get(session.id) ?? nowMs
      this.firstSeen.set(session.id, seen)
      session.lastActivityAt ||= seen
    }
    return { sessions, complete: output.complete }
  }

  private absorb(file: DiscoveredFile): void {
    const cached = this.cache.get(file.path)
    if (cached && cached.size === file.size) {
      cached.mtimeMs = file.mtimeMs
      return
    }
    if (file.tail === null) {
      // Over this scan's read budget: keep the old summary until a later scan reads it.
      if (cached) {
        cached.mtimeMs = file.mtimeMs
      }
      return
    }
    const head = file.head ?? cached?.head ?? null
    const summarize = file.provider === 'claude' ? summarizeClaudeTranscript : summarizeCodexRollout
    const summary = summarize({
      path: file.path,
      head,
      tail: file.tail,
      tailIsWholeFile: file.size <= this.limits.tailBytes
    })
    this.cache.set(file.path, {
      path: file.path,
      size: file.size,
      mtimeMs: file.mtimeMs,
      head,
      summary: {
        ...summary,
        title: summary.title ?? cached?.summary.title ?? null,
        cwd: summary.cwd ?? cached?.summary.cwd ?? null,
        firstAt: summary.firstAt ?? cached?.summary.firstAt ?? null
      }
    })
  }
}
