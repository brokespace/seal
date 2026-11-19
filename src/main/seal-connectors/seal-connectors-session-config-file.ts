import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'

const FILE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

function sessionConfigDir(): string {
  return join(getAppEnvironment().getPath('userData'), 'seal-connectors', 'session-configs')
}

async function pruneOldConfigs(dir: string): Promise<void> {
  const cutoff = Date.now() - FILE_MAX_AGE_MS
  for (const name of await readdir(dir)) {
    try {
      const file = join(dir, name)
      if ((await stat(file)).mtimeMs < cutoff) {
        await rm(file, { force: true })
      }
    } catch {
      // Another launch may be pruning the same file.
    }
  }
}

async function writeSessionMcpConfig(file: string, json: string): Promise<void> {
  const dir = sessionConfigDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const staged = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(staged, json, { mode: 0o600 })
    await rename(staged, file)
  } catch (error) {
    await rm(staged, { force: true })
    throw error
  }
  // Pruning is housekeeping; the launch must not depend on it.
  await pruneOldConfigs(dir).catch(() => {})
}

/**
 * Builds a session's connector args, writing its `--mcp-config` JSON (placeholders only, never
 * secrets) to a file first: PowerShell and cmd mangle inline JSON, a file path survives every shell.
 */
export async function withSessionMcpConfig(
  sessionId: string,
  build: (mcpConfigArgument: (json: string) => string) => string[]
): Promise<string[]> {
  const file = join(
    sessionConfigDir(),
    `${sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128)}.json`
  )
  const writes: Promise<void>[] = []
  const args = build((json) => {
    writes.push(writeSessionMcpConfig(file, json))
    return file
  })
  await Promise.all(writes)
  return args
}
