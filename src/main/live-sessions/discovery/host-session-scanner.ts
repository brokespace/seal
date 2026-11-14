import type {
  LiveSession,
  LiveSessionMachine
} from '../../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { buildDiscoveryScript } from './discovery-script'
import { parseDiscoveryOutput, type DiscoveredFile } from './discovery-output'
import { assembleHostSessions, type SummarizedTranscript } from './session-assembly'
import { summarizeClaudeTranscript, summarizeCodexRollout } from './transcript-summary'
import { foldClaudeActivity, newClaudeActivityState } from './claude-transcript-activity'
import { summarizeSubagentFile, type SubagentFileSummary } from './claude-subagent-files'
import { codexPlan } from './codex-transcript-activity'
import { recordsOf } from './transcript-records'

export type HostScanLimits = {
  maxAgeMinutes: number
  maxFiles: number
  maxReads: number
  headBytes: number
  tailBytes: number
  /** Subagent transcripts listed per session, and how many are read per scan across the host. */
  maxSubagents: number
  maxSubagentReads: number
  subagentTailBytes: number
}

export const LOCAL_SCAN_LIMITS: HostScanLimits = {
  maxAgeMinutes: 12 * 60,
  maxFiles: 60,
  maxReads: 60,
  headBytes: 16 * 1024,
  tailBytes: 48 * 1024,
  maxSubagents: 24,
  maxSubagentReads: 48,
  subagentTailBytes: 12 * 1024
}

// SSH exec keeps only the last 1 MB of output; a handful of reads stays well under it.
export const SSH_SCAN_LIMITS: HostScanLimits = {
  ...LOCAL_SCAN_LIMITS,
  maxFiles: 40,
  maxReads: 6,
  maxSubagents: 12,
  maxSubagentReads: 10,
  subagentTailBytes: 6 * 1024
}

// A runtime answers up to 4 MB of JSON; the server caps the script's output below that.
export const RUNTIME_SCAN_LIMITS: HostScanLimits = { ...LOCAL_SCAN_LIMITS, maxReads: 16 }

export function scanLimitsFor(machine: LiveSessionMachine): HostScanLimits {
  if (machine.kind === 'local') {
    return LOCAL_SCAN_LIMITS
  }
  return machine.connection === 'server' ? RUNTIME_SCAN_LIMITS : SSH_SCAN_LIMITS
}

type CachedTranscript = SummarizedTranscript & {
  head: string | null
  subagentFiles: Map<string, SubagentFileSummary>
}

export type HostScanResult = { sessions: LiveSession[]; complete: boolean }

/** Scans one host, re-reading only transcripts that grew since the last scan. */
export class HostSessionScanner {
  private readonly cache = new Map<string, CachedTranscript>()
  private readonly firstSeen = new Map<string, number>()

  constructor(
    private readonly host: LiveSessionHost,
    private readonly limits: HostScanLimits
  ) {}

  async scan(nowMs: number): Promise<HostScanResult> {
    const cached = [...this.cache.values()]
    const known = cached.flatMap((t) => [
      { path: t.path, size: t.size },
      ...[...t.subagentFiles.values()].map((sub) => ({ path: sub.path, size: sub.size }))
    ])
    const headKnown = cached.filter((t) => t.head !== null).map((t) => t.path)
    const findFiles = this.host.transcriptFiles
    const script = buildDiscoveryScript({
      ...this.limits,
      transcripts: !findFiles,
      known: findFiles ? [] : known,
      headKnown: findFiles ? [] : headKnown
    })
    const output = parseDiscoveryOutput(await this.host.run(script))
    if (findFiles) {
      // After the script: it names the transcripts running agents own, which are listed however old.
      output.files = await findFiles({
        ...this.limits,
        nowMs,
        known: new Map(known.map((k) => [k.path, k.size])),
        headKnown: new Set(headKnown),
        pinned: output.pins
      })
    }
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

  /** Subagent transcripts change while their session's own file stands still. */
  private absorbSubagents(cached: CachedTranscript, file: DiscoveredFile): void {
    const listed = new Map<string, SubagentFileSummary>()
    for (const sub of file.subagents ?? []) {
      const previous = cached.subagentFiles.get(sub.path)
      const summary = summarizeSubagentFile(sub, this.limits.subagentTailBytes, previous)
      if (summary) {
        // Unread bytes (over the budget) keep the size they were last read at, so they are read later.
        const unread = sub.tail === null && previous?.size !== sub.size
        listed.set(sub.path, unread ? { ...summary, size: previous?.size ?? -1 } : summary)
      }
    }
    cached.subagentFiles = listed
    cached.subagents = [...listed.values()]
  }

  private absorb(file: DiscoveredFile): void {
    const cached = this.cache.get(file.path)
    if (cached) {
      this.absorbSubagents(cached, file)
    }
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
    const tailIsWholeFile = file.size <= this.limits.tailBytes
    const records = recordsOf(file.tail, !tailIsWholeFile)
    // A file that shrank was rewritten: what the old bytes launched no longer holds.
    const grew = cached !== undefined && file.size > cached.size
    const claudeActivity = (grew ? cached.claudeActivity : undefined) ?? newClaudeActivityState()
    if (file.provider === 'claude') {
      foldClaudeActivity(claudeActivity, records)
    }
    const next: CachedTranscript = {
      path: file.path,
      size: file.size,
      mtimeMs: file.mtimeMs,
      head,
      summary: {
        ...summary,
        title: summary.title ?? cached?.summary.title ?? null,
        cwd: summary.cwd ?? cached?.summary.cwd ?? null,
        firstAt: summary.firstAt ?? cached?.summary.firstAt ?? null,
        lastMessage: summary.lastMessage ?? cached?.summary.lastMessage ?? null
      },
      ...(file.provider === 'claude'
        ? { claudeActivity }
        : { codexPlan: codexPlan(records, (grew ? cached.codexPlan : null) ?? null) }),
      subagentFiles: cached?.subagentFiles ?? new Map(),
      subagents: cached?.subagents ?? []
    }
    this.cache.set(file.path, next)
    if (!cached) {
      this.absorbSubagents(next, file)
    }
  }
}
