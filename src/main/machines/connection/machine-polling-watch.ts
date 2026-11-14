import type { MachineFileEntry } from '../../../shared/machines/machine-types'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'

export const MACHINE_WATCH_POLL_MS = 3_000

function signature(entries: readonly MachineFileEntry[]): string {
  return entries
    .map((entry) => `${entry.name}\u0000${entry.kind}\u0000${entry.size}\u0000${entry.mtimeMs}`)
    .sort()
    .join('\u0001')
}

/** Relists `dirs` on a timer and reports the ones whose entries changed. */
export function watchByPolling(
  files: Pick<MachineFileSystem, 'listDir'>,
  dirs: readonly string[],
  onChange: (dir: string) => void,
  intervalMs = MACHINE_WATCH_POLL_MS
): () => void {
  const seen = new Map<string, string>()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const sweep = async (): Promise<void> => {
    for (const dir of dirs) {
      if (stopped) {
        return
      }
      const next = await files.listDir(dir).then(signature, () => null)
      if (next === null) {
        continue
      }
      const previous = seen.get(dir)
      seen.set(dir, next)
      if (previous !== undefined && previous !== next) {
        onChange(dir)
      }
    }
  }
  const loop = (): void => {
    void sweep().finally(() => {
      if (!stopped) {
        timer = setTimeout(loop, intervalMs)
      }
    })
  }
  loop()
  return () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/** Every machine delivers changes: a native feed when the host has one, polling otherwise. */
export function withPollingWatch(
  files: MachineFileSystem,
  intervalMs = MACHINE_WATCH_POLL_MS
): MachineFileSystem {
  return {
    machineId: files.machineId,
    homeDir: () => files.homeDir(),
    listDir: (path) => files.listDir(path),
    stat: (path) => files.stat(path),
    readFile: (path, maxBytes) => files.readFile(path, maxBytes),
    writeFile: (path, data) => files.writeFile(path, data),
    createDir: (path) => files.createDir(path),
    rename: (from, to) => files.rename(from, to),
    remove: (path) => files.remove(path),
    openTransferSession: (signal) => files.openTransferSession(signal),
    downloadUrl: (url, destination, onProgress, signal) =>
      files.downloadUrl(url, destination, onProgress, signal),
    watch: async (dirs, onChange) =>
      (await files.watch(dirs, onChange)) ?? watchByPolling(files, dirs, onChange, intervalMs)
  }
}
