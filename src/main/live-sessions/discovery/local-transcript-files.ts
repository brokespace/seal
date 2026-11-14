import { open, stat } from 'node:fs/promises'
import type { AiVaultScanIssue } from '../../../shared/ai-vault/contracts/ai-vault-types'
import { AI_VAULT_AGENT_SOURCES } from '../../ai-vault/discovery/session-scanner-agent-sources'
import { discoverFiles } from '../../ai-vault/discovery/session-scanner-discovery'
import type { AiVaultScanOptions, FileWithMtime } from '../../ai-vault/session-scanner-types'
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import type { DiscoveredFile } from './discovery-output'
import { localSubagentFiles } from './local-subagent-files'

export type TranscriptFileRequest = {
  nowMs: number
  maxAgeMinutes: number
  maxFiles: number
  maxReads: number
  headBytes: number
  tailBytes: number
  maxSubagents: number
  maxSubagentReads: number
  subagentTailBytes: number
  /** Transcripts (and subagent transcripts) already read at this size: their bytes are skipped. */
  known: ReadonlyMap<string, number>
  /** Paths whose head was already read: only their tail is read when they grow. */
  headKnown: ReadonlySet<string>
  /** Transcripts running agents own: listed first, whatever their age. */
  pinned?: readonly { provider: LiveSessionProvider; path: string }[]
}

/** Finds a host's recent transcripts and reads the bytes a scan needs, in place of the script's `find`. */
export type TranscriptFileSource = (request: TranscriptFileRequest) => Promise<DiscoveredFile[]>

// Archived Codex rollouts (.jsonl.zst) are idle for days, so live discovery skips them.
const LIVE_EXTENSIONS = ['.jsonl']

/** AI Vault's discovery rules and roots (account profiles, extra Codex homes), read on this machine. */
export function aiVaultTranscriptFiles(
  scanOptions: () => Promise<AiVaultScanOptions>
): TranscriptFileSource {
  return async (request) => {
    const options = await scanOptions()
    const wslHomeDirs = options.wslHomeDirs ?? []
    const issues: AiVaultScanIssue[] = []
    const sources = [
      ['claude', AI_VAULT_AGENT_SOURCES.claude],
      ['codex', AI_VAULT_AGENT_SOURCES.codex]
    ] as const
    const found = await Promise.all(
      sources.flatMap(([provider, source]) => {
        if (!source) {
          return []
        }
        return source.rootDirs(options, wslHomeDirs).map(async (rootDir) => {
          const discovery = await discoverFiles({
            rootDir,
            limit: request.maxFiles,
            agent: provider,
            issues,
            extensions: LIVE_EXTENSIONS,
            filePredicate: source.filePredicate,
            directoryPredicate: source.directoryPredicate
          })
          return discovery.files.map((file) => ({ provider, file }))
        })
      })
    )
    const oldest = request.nowMs - request.maxAgeMinutes * 60_000
    const seen = new Set<string>()
    const pinned = await pinnedFiles(request.pinned ?? [], seen)
    const recent = [
      ...pinned,
      ...found
        .flat()
        .filter(({ file }) => file.mtimeMs >= oldest && !seen.has(file.path) && seen.add(file.path))
        .sort((a, b) => b.file.mtimeMs - a.file.mtimeMs)
    ].slice(0, request.maxFiles)
    let reads = 0
    const subagentBudget = { reads: request.maxSubagentReads }
    const out: DiscoveredFile[] = []
    for (const { provider, file } of recent) {
      const size = await sizeOf(file)
      if (size === null) {
        continue
      }
      const listed: DiscoveredFile = {
        provider,
        path: file.path,
        size,
        mtimeMs: file.mtimeMs,
        head: null,
        tail: null
      }
      if (request.known.get(file.path) !== size && reads < request.maxReads) {
        reads++
        const bytes = await readEnds(file.path, size, request, !request.headKnown.has(file.path))
        listed.head = bytes?.head ?? null
        listed.tail = bytes?.tail ?? null
      }
      if (provider === 'claude') {
        const subagents = await localSubagentFiles(file.path, request, subagentBudget)
        if (subagents) {
          listed.subagents = subagents
        }
      }
      out.push(listed)
    }
    return out
  }
}

async function pinnedFiles(
  pins: readonly { provider: LiveSessionProvider; path: string }[],
  seen: Set<string>
): Promise<{ provider: LiveSessionProvider; file: FileWithMtime }[]> {
  const out: { provider: LiveSessionProvider; file: FileWithMtime }[] = []
  for (const { provider, path } of pins) {
    if (seen.has(path)) {
      continue
    }
    const info = await stat(path).catch(() => null)
    if (info?.isFile()) {
      seen.add(path)
      out.push({
        provider,
        file: {
          path,
          mtimeMs: info.mtimeMs,
          modifiedAt: info.mtime.toISOString(),
          sizeBytes: info.size
        }
      })
    }
  }
  return out
}

async function sizeOf(file: FileWithMtime): Promise<number | null> {
  if (file.sizeBytes !== undefined) {
    return file.sizeBytes
  }
  return stat(file.path).then(
    (s) => s.size,
    () => null
  )
}

async function readEnds(
  path: string,
  size: number,
  request: Pick<TranscriptFileRequest, 'headBytes' | 'tailBytes'>,
  withHead: boolean
): Promise<{ head: string | null; tail: string } | null> {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) {
    return null
  }
  try {
    const read = async (from: number, length: number): Promise<string> => {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, from)
      return buffer.subarray(0, bytesRead).toString('utf8')
    }
    const tailLength = Math.min(size, request.tailBytes)
    return {
      head: withHead ? await read(0, Math.min(size, request.headBytes)) : null,
      tail: await read(size - tailLength, tailLength)
    }
  } catch {
    return null
  } finally {
    await handle.close()
  }
}
