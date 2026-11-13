import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import type { MachineFileStat } from './machine-filesystem'
import {
  parseContentLength,
  posixDownloadUrlCommand,
  posixInotifyWatchCommand,
  posixUrlContentLengthCommand
} from './posix-machine-commands'

const URL_DOWNLOAD_TIMEOUT_MS = 12 * 60 * 60 * 1000
const URL_PROGRESS_POLL_MS = 1_000
const URL_PROGRESS_MAX_POLL_MS = 15_000

/** Runs curl/wget on the host itself, so the bytes never cross this computer; progress comes from polling the file size. */
export async function runPosixUrlDownload(args: {
  conn: SshConnection
  url: string
  destination: string
  onProgress: (transferred: number, total: number | null) => void
  signal: AbortSignal
  stat: (target: string) => Promise<MachineFileStat>
}): Promise<void> {
  const { conn, url, destination, onProgress, signal, stat } = args
  const total = parseContentLength(
    await execCommand(conn, posixUrlContentLengthCommand(url), { signal }).catch(() => '')
  )
  // A stalled download (slow DNS, a server that has not sent bytes yet) backs the size poll off.
  let delay = URL_PROGRESS_POLL_MS
  let lastSize = -1
  let timer: ReturnType<typeof setTimeout> | null = null
  let finished = false
  const poll = (): void => {
    timer = setTimeout(() => {
      void stat(destination)
        .then(
          (entry) => {
            delay =
              entry.size > lastSize
                ? URL_PROGRESS_POLL_MS
                : Math.min(delay * 2, URL_PROGRESS_MAX_POLL_MS)
            lastSize = entry.size
            onProgress(entry.size, total)
          },
          () => {
            delay = Math.min(delay * 2, URL_PROGRESS_MAX_POLL_MS)
          }
        )
        .finally(() => {
          if (!finished) {
            poll()
          }
        })
    }, delay)
  }
  poll()
  try {
    await execCommand(conn, posixDownloadUrlCommand(url, destination), {
      timeoutMs: URL_DOWNLOAD_TIMEOUT_MS,
      signal
    })
    const done = await stat(destination).catch(() => null)
    onProgress(done?.size ?? total ?? 0, done?.size ?? total)
  } finally {
    finished = true
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export async function hasInotifyWait(conn: SshConnection): Promise<boolean> {
  return execCommand(conn, 'command -v inotifywait >/dev/null 2>&1 && echo yes')
    .then((out) => out.trim() === 'yes')
    .catch(() => false)
}

/** Streams `inotifywait` over one exec channel and reports which watched folder changed. */
export async function startPosixInotifyWatch(
  conn: SshConnection,
  dirs: string[],
  onChange: (dir: string) => void
): Promise<() => void> {
  const channel = await conn.exec(posixInotifyWatchCommand(dirs))
  const watched = new Set(dirs.map((dir) => dir.replace(/\/+$/, '') || '/'))
  let buffered = ''
  channel.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      const dir = line.replace(/\/+$/, '') || '/'
      if (watched.has(dir)) {
        onChange(dir)
      }
    }
  })
  channel.stderr.resume()
  channel.on('error', () => {})
  return () => {
    try {
      channel.close()
    } catch {}
  }
}
