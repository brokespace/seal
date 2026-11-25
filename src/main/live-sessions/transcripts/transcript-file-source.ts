import { open } from 'node:fs/promises'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { ELIDING_LINES_AWK, elideBase64Runs } from './transcript-base64-elision'

export type TranscriptLine = { offset: number; text: string }

export type TranscriptLinesRead = {
  /** The file's size when read. */
  size: number
  /** Whole, non-blank lines with their long base64 runs elided, oldest first. */
  lines: TranscriptLine[]
  /** Where the lines begin; for a read that held no whole line, where it looked from. */
  start: number
  /** Just past the last whole line. */
  end: number
}

/** A transcript file wherever it lives, read a batch of whole lines at a time. */
export type TranscriptSource = {
  /** The lines that end at `end` (the file's end when null), as many as one read holds. */
  linesBefore(end: number | null): Promise<TranscriptLinesRead>
  /** The lines that start at `start`, as many as one read holds. */
  linesFrom(start: number): Promise<TranscriptLinesRead>
  /** A base64 run a line's marker names, as the file holds it. */
  base64Run(start: number, length: number): Promise<string>
  size(): Promise<number>
}

type ByteRange = { bytes: Buffer; size: number }
type ReadBytes = (start: number, length: number) => Promise<ByteRange>

const BACK_CHUNK = 256 * 1024
const FORWARD_CHUNK = 512 * 1024
/** A record longer than this is stepped over, not read. */
const MAX_LINE_BYTES = 16 * 1024 * 1024

/** Complete lines in `bytes` (which starts at `start`); a trailing partial line is left unread. */
export function completeLines(
  bytes: Buffer,
  start: number,
  dropLeadingPartial: boolean
): { lines: TranscriptLine[]; first: number | null; end: number } {
  const lines: TranscriptLine[] = []
  let at = 0
  if (dropLeadingPartial) {
    const nl = bytes.indexOf(0x0a)
    if (nl === -1) {
      return { lines, first: null, end: start }
    }
    at = nl + 1
  }
  const first = at
  for (;;) {
    const nl = bytes.indexOf(0x0a, at)
    if (nl === -1) {
      break
    }
    const text = elideBase64Runs(bytes.subarray(at, nl))
    if (text.trim()) {
      lines.push({ offset: start + at, text })
    }
    at = nl + 1
  }
  return { lines, first: at > first ? start + first : null, end: start + at }
}

const BASE64_RUN = /^[A-Za-z0-9+/]*={0,2}$/

/** Reads lines out of byte ranges; a record bigger than a range is read with a bigger one. */
function byteRangeSource(read: ReadBytes): TranscriptSource {
  return {
    size: async () => (await read(0, 0)).size,
    async linesBefore(end) {
      const { size } = await read(0, 0)
      const to = end === null ? size : Math.min(end, size)
      for (let chunk = BACK_CHUNK; ; chunk = Math.min(chunk * 2, MAX_LINE_BYTES)) {
        const from = Math.max(0, to - chunk)
        const { bytes } = await read(from, to - from)
        const { lines, first, end: last } = completeLines(bytes, from, from > 0)
        if (first !== null || from === 0) {
          return { size, lines, start: first ?? from, end: last }
        }
        if (chunk >= MAX_LINE_BYTES) {
          return { size, lines, start: from, end: to }
        }
      }
    },
    async linesFrom(start) {
      for (let chunk = FORWARD_CHUNK; ; chunk = Math.min(chunk * 2, MAX_LINE_BYTES)) {
        const { bytes, size } = await read(start, chunk)
        const { lines, end } = completeLines(bytes, start, false)
        if (end > start || bytes.length < chunk || start + bytes.length >= size) {
          return { size, lines, start, end }
        }
        if (chunk >= MAX_LINE_BYTES) {
          // One enormous record: step past it instead of stalling every reader behind it.
          return { size, lines, start, end: start + bytes.length }
        }
      }
    },
    async base64Run(start, length) {
      const text = (await read(start, length)).bytes.toString('latin1')
      return BASE64_RUN.test(text) ? text : ''
    }
  }
}

export function localTranscriptSource(path: string): TranscriptSource {
  return byteRangeSource(async (start, length) => {
    // A session is listed before its agent writes the file: that reads as empty, as on a remote host.
    const handle = await open(path, 'r').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (!handle) {
      return { bytes: Buffer.alloc(0), size: 0 }
    }
    try {
      const { size } = await handle.stat()
      const want = Math.max(0, Math.min(length, size - start))
      const bytes = Buffer.alloc(want)
      const { bytesRead } = want > 0 ? await handle.read(bytes, 0, want, start) : { bytesRead: 0 }
      return { bytes: bytes.subarray(0, bytesRead), size }
    } finally {
      await handle.close()
    }
  })
}

// SSH and `liveSessions.hostRun` cap a script's output, so bytes that cross as they are go in pieces.
const REMOTE_PIECE_BYTES = 640 * 1024
/** How much of the file one remote read looks at; what it sends back is `REMOTE_TEXT_BUDGET` of it. */
const REMOTE_WINDOW_BYTES = MAX_LINE_BYTES
const REMOTE_TEXT_BUDGET = 512 * 1024

const sizeScript = (path: string): string =>
  `f=${quotePosixShell(path)}; s=$(wc -c < "$f" 2>/dev/null | tr -d ' '); s=\${s:-0}; echo "@@SIZE $s"; `

const sizeIn = (out: string): number => Number(/@@SIZE (\d+)/.exec(out)?.[1] ?? 0)

function remoteByteRanges(host: LiveSessionHost, path: string): ReadBytes {
  return async (start, length) => {
    const pieces: Buffer[] = []
    let size = 0
    for (let at = start; ; at += REMOTE_PIECE_BYTES) {
      const want = Math.min(REMOTE_PIECE_BYTES, start + length - at)
      const out = await host.run(
        `${sizeScript(path)}printf '@@BYTES '; ` +
          `tail -c +${at + 1} "$f" 2>/dev/null | head -c ${Math.max(0, want)} | base64 | tr -d '\\n'; echo`
      )
      size = sizeIn(out)
      const piece = Buffer.from(/@@BYTES (\S*)/.exec(out)?.[1] ?? '', 'base64')
      pieces.push(piece)
      if (piece.length < REMOTE_PIECE_BYTES || at + piece.length >= start + length) {
        return { bytes: pieces.length === 1 ? piece : Buffer.concat(pieces), size }
      }
    }
  }
}

const inflate = promisify(gunzip)

type ElidedWindow = {
  size: number
  /** The bytes of the file the host looked at. */
  from: number
  to: number
  /** Where the first line it sent begins, and just past the last. */
  first: number
  past: number
  lines: TranscriptLine[]
}

/** Hosts found to lack awk or gzip: their transcripts cross whole. */
const plainHosts = new WeakSet<LiveSessionHost>()

/**
 * A transcript on a host that is only a shell. The host cuts the lines and elides their base64
 * itself, so megabytes of images cost one round trip and none of their bytes.
 */
export function remoteTranscriptSource(host: LiveSessionHost, path: string): TranscriptSource {
  const plain = byteRangeSource(remoteByteRanges(host, path))

  /** Runs the eliding read over the window `bounds` sets as `$a` and `$e`; null on a host that can't. */
  const elided = async (bounds: string, newest: boolean): Promise<ElidedWindow | null> => {
    if (plainHosts.has(host)) {
      return null
    }
    const out = await host.run(
      `${sizeScript(path)}` +
        `if command -v awk >/dev/null 2>&1 && command -v gzip >/dev/null 2>&1; then ${bounds}; ` +
        `echo "@@WINDOW $a $e"; printf '@@LINES '; ` +
        `{ tail -c +$((a + 1)) "$f" 2>/dev/null | head -c $((e - a)); echo; } | ` +
        `LC_ALL=C awk -v budget=${REMOTE_TEXT_BUDGET} -v newest=${newest ? 1 : 0} ` +
        `-v lead=${newest ? '$((a > 0))' : 0} '${ELIDING_LINES_AWK}' | gzip -c | base64 | tr -d '\\n'; ` +
        `echo; echo '@@DONE'; else echo '@@PLAIN'; fi`
    )
    if (out.includes('@@PLAIN')) {
      plainHosts.add(host)
      return null
    }
    const window = /@@WINDOW (\d+) (\d+)/.exec(out)
    const packed = /@@LINES (\S*)/.exec(out)
    if (!window || !packed || !out.includes('@@DONE')) {
      throw new Error('The transcript read came back cut off')
    }
    const [skipped, ...rows] = (await inflate(Buffer.from(packed[1], 'base64')))
      .toString('utf8')
      .split('\n')
    const lines: TranscriptLine[] = []
    const first = Number(window[1]) + Number(skipped)
    let offset = first
    for (const row of rows) {
      const tab = row.indexOf('\t')
      if (tab === -1) {
        continue
      }
      const text = row.slice(tab + 1)
      if (text.trim()) {
        lines.push({ offset, text })
      }
      offset += Number(row.slice(0, tab)) + 1
    }
    return {
      size: sizeIn(out),
      from: Number(window[1]),
      to: Number(window[2]),
      first,
      past: offset,
      lines
    }
  }

  return {
    size: plain.size,
    async linesBefore(end) {
      const read = await elided(
        `e=${end ?? '$s'}; [ "$e" -gt "$s" ] && e=$s; ` +
          `a=$((e > ${REMOTE_WINDOW_BYTES} ? e - ${REMOTE_WINDOW_BYTES} : 0))`,
        true
      )
      if (!read) {
        return plain.linesBefore(end)
      }
      const none = read.past === read.first
      return {
        size: read.size,
        lines: read.lines,
        start: none ? read.from : read.first,
        end: none && read.from > 0 ? read.to : read.past
      }
    },
    async linesFrom(start) {
      const read = await elided(
        `a=${start}; [ "$a" -gt "$s" ] && a=$s; ` +
          `e=$((a + ${REMOTE_WINDOW_BYTES} < s ? a + ${REMOTE_WINDOW_BYTES} : s))`,
        false
      )
      if (!read) {
        return plain.linesFrom(start)
      }
      // A record that fills the whole window is stepped past, as a local read does.
      const stuck = read.past === start && read.to < read.size
      return { size: read.size, lines: read.lines, start, end: stuck ? read.to : read.past }
    },
    async base64Run(start, length) {
      const pieces: string[] = []
      for (let at = start; at < start + length; at += REMOTE_PIECE_BYTES) {
        const want = Math.min(REMOTE_PIECE_BYTES, start + length - at)
        const out = await host.run(
          `f=${quotePosixShell(path)}; printf '@@RUN '; ` +
            `tail -c +${at + 1} "$f" 2>/dev/null | head -c ${want} | LC_ALL=C tr -cd 'A-Za-z0-9+/='; echo`
        )
        pieces.push(/@@RUN (\S*)/.exec(out)?.[1] ?? '')
      }
      const text = pieces.join('')
      return text.length === length && BASE64_RUN.test(text) ? text : ''
    }
  }
}

export function transcriptSourceFor(host: LiveSessionHost, path: string): TranscriptSource {
  return host.machine.kind === 'local'
    ? localTranscriptSource(path)
    : remoteTranscriptSource(host, path)
}
