import { joinMachinePath } from '../../shared/machines/machine-paths'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../machines/connection/machine-connection'

const MAX_FILES = 500
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_DEPTH = 12
const EXEC_TIMEOUT_MS = 30_000

type Budget = { files: number; bytes: number }

async function copyDir(
  source: MachineConnection,
  from: string,
  destination: MachineConnection,
  to: string,
  depth: number,
  budget: Budget
): Promise<void> {
  if (depth > MAX_DEPTH) {
    throw new Error(`${from} is nested too deeply to copy`)
  }
  await destination.files.createDir(to)
  for (const entry of await source.files.listDir(from)) {
    const sourcePath = joinMachinePath(from, entry.name)
    const targetPath = joinMachinePath(to, entry.name)
    if (entry.isDirectoryLike) {
      await copyDir(source, sourcePath, destination, targetPath, depth + 1, budget)
      continue
    }
    if (entry.kind === 'other') {
      continue
    }
    const read = await source.files.readFile(sourcePath, MAX_FILE_BYTES)
    budget.files += 1
    budget.bytes += read.data.length
    if (
      read.size > read.data.length ||
      budget.files > MAX_FILES ||
      budget.bytes > MAX_TOTAL_BYTES
    ) {
      throw new Error(`${from} is too large to copy from Settings; use the Machines page`)
    }
    await destination.files.writeFile(targetPath, read.data)
  }
}

/** Scripts inside a skill must stay runnable; the file API carries bytes, not modes. */
async function copyExecutableBits(
  source: MachineConnection,
  from: string,
  destination: MachineConnection,
  to: string
): Promise<void> {
  if ((await source.dialect()) !== 'posix' || (await destination.dialect()) !== 'posix') {
    return
  }
  const found = await source.exec(`cd ${quotePosixShell(from)} && find . -type f -perm -100`, {
    timeoutMs: EXEC_TIMEOUT_MS
  })
  const files = found.stdout.split('\n').filter((line) => line.startsWith('./'))
  if (found.exitCode !== 0 || files.length === 0) {
    return
  }
  await destination.exec(
    `cd ${quotePosixShell(to)} && chmod +x -- ${files.map(quotePosixShell).join(' ')}`,
    { timeoutMs: EXEC_TIMEOUT_MS }
  )
}

/**
 * Copies a folder between any two machines through the same file API both transports implement,
 * so SSH to Seal server works like SSH to SSH. The destination must not exist yet.
 */
export async function copyMachineTree(
  source: MachineConnection,
  from: string,
  destination: MachineConnection,
  to: string
): Promise<void> {
  try {
    await copyDir(source, from, destination, to, 0, { files: 0, bytes: 0 })
    await copyExecutableBits(source, from, destination, to).catch(() => {})
  } catch (error) {
    // Half a skill is worse than none.
    await destination.files.remove(to).catch(() => {})
    throw error
  }
}
