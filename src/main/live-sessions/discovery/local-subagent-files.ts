import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeSubagentsDir, type DiscoveredSubagentFile } from './claude-subagent-files'

export type SubagentFileRequest = {
  nowMs: number
  maxSubagents: number
  subagentTailBytes: number
  /** Files already read at this size: their bytes are skipped. */
  known: ReadonlyMap<string, number>
}

/** A meta file can change after its transcript's last write, so recent ones are re-read. */
const META_FRESH_MS = 10 * 60_000

async function tailOf(path: string, size: number, bytes: number): Promise<string | null> {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) {
    return null
  }
  try {
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, size - length)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/** The subagent transcripts beside a Claude session's transcript on this machine, newest first. */
export async function localSubagentFiles(
  transcriptPath: string,
  request: SubagentFileRequest,
  budget: { reads: number }
): Promise<DiscoveredSubagentFile[] | undefined> {
  const dir = claudeSubagentsDir(transcriptPath)
  const names = await readdir(dir).catch(() => null)
  if (!names) {
    return undefined
  }
  const listed: DiscoveredSubagentFile[] = []
  for (const name of names) {
    if (!/^agent-[A-Za-z0-9_-]+\.jsonl$/.test(name)) {
      continue
    }
    const path = join(dir, name)
    const info = await stat(path).catch(() => null)
    if (info?.isFile()) {
      listed.push({ path, size: info.size, mtimeMs: info.mtimeMs, meta: null, tail: null })
    }
  }
  listed.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const newest = listed.slice(0, request.maxSubagents)
  for (const file of newest) {
    const seen = request.known.get(file.path) === file.size
    if (!seen || request.nowMs - file.mtimeMs < META_FRESH_MS) {
      file.meta = await readFile(file.path.replace(/\.jsonl$/, '.meta.json'), 'utf8').catch(
        () => null
      )
    }
    if (!seen && budget.reads > 0) {
      budget.reads--
      file.tail = await tailOf(file.path, file.size, request.subagentTailBytes)
    }
  }
  return newest
}
