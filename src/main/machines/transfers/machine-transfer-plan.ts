import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { joinMachinePath, machinePathBasename } from '../../../shared/machines/machine-paths'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'

export type TransferFile = { source: string; segments: string[]; size: number }

export type TransferPlan = {
  /** Folders to create, as segments under the destination, parents first. */
  dirs: string[][]
  files: TransferFile[]
  totalBytes: number
}

/** `report.pdf` → `report (1).pdf`, so drops never overwrite what is already there. */
export function uniqueMachineName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) {
    return name
  }
  const dot = name.lastIndexOf('.')
  const hasExtension = dot > 0
  const stem = hasExtension ? name.slice(0, dot) : name
  const extension = hasExtension ? name.slice(dot) : ''
  for (let index = 1; ; index += 1) {
    const candidate = `${stem} (${index})${extension}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

/** Assigns each top-level source a name that is free in the destination folder. */
export function assignTopLevelNames(sourceNames: string[], existing: Iterable<string>): string[] {
  const taken = new Set(existing)
  return sourceNames.map((name) => {
    const unique = uniqueMachineName(name, taken)
    taken.add(unique)
    return unique
  })
}

export function joinSegments(root: string, segments: string[]): string {
  return segments.reduce((dir, segment) => joinMachinePath(dir, segment), root)
}

type TreeReader = {
  isDirectory(source: string): Promise<{ directory: boolean; size: number }>
  children(source: string): Promise<string[]>
  join(dir: string, name: string): string
}

async function planTree(
  sources: string[],
  topNames: string[],
  reader: TreeReader,
  signal: AbortSignal
): Promise<TransferPlan> {
  const plan: TransferPlan = { dirs: [], files: [], totalBytes: 0 }
  const visit = async (source: string, segments: string[]): Promise<void> => {
    if (signal.aborted) {
      throw new Error('Transfer cancelled')
    }
    const info = await reader.isDirectory(source)
    if (!info.directory) {
      plan.files.push({ source, segments, size: info.size })
      plan.totalBytes += info.size
      return
    }
    plan.dirs.push(segments)
    for (const name of await reader.children(source)) {
      await visit(reader.join(source, name), [...segments, name])
    }
  }
  for (const [index, source] of sources.entries()) {
    await visit(source, [topNames[index]])
  }
  return plan
}

export function planLocalTree(
  sources: string[],
  topNames: string[],
  signal: AbortSignal
): Promise<TransferPlan> {
  return planTree(
    sources,
    topNames,
    {
      async isDirectory(source) {
        // lstat so a symlink cycle cannot recurse forever; links copy as their target file.
        const info = await lstat(source)
        return { directory: info.isDirectory(), size: info.size }
      },
      children: (source) => readdir(source),
      join: (dir, name) => path.join(dir, name)
    },
    signal
  )
}

export function planMachineTree(
  fs: MachineFileSystem,
  sources: string[],
  topNames: string[],
  signal: AbortSignal
): Promise<TransferPlan> {
  return planTree(
    sources,
    topNames,
    {
      async isDirectory(source) {
        const info = await fs.stat(source)
        return { directory: info.kind === 'directory', size: info.size }
      },
      children: async (source) => (await fs.listDir(source)).map((entry) => entry.name),
      join: joinMachinePath
    },
    signal
  )
}

export function sourceBasename(source: string): string {
  return machinePathBasename(source)
}
