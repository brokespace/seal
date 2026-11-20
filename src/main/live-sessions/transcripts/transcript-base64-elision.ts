// Agents write images into their transcripts as base64 runs of megabytes. A reader leaves those in
// the file: each run reads as a marker naming its bytes, which an image row turns into a reference.

/** Shorter runs stay in the line: hashes, tokens and thumbnail-sized images. */
export const ELIDED_RUN_MIN_BYTES = 4096
// A run is only looked at once it is this long, so ordinary words cost nothing.
const RUN_PREFIX_BYTES = 100
/** A line that is still this long without its base64 reads as blank, as one too big to read did. */
const SLIM_LINE_MAX_BYTES = 1024 * 1024

const BASE64_BYTE = new Uint8Array(256)
for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/') {
  BASE64_BYTE[char.charCodeAt(0)] = 1
}
const PADDING = 0x3d

const marker = (at: number, length: number): string => `[base64 ${length} bytes at ${at}]`

const MARKER = /^\[base64 (\d+) bytes at (\d+)\]$/

/** Where in its line the run a marker stands for sits; null for any other text. */
export function readElidedRun(text: string): { at: number; length: number } | null {
  const match = MARKER.exec(text)
  return match ? { at: Number(match[2]), length: Number(match[1]) } : null
}

/** One transcript line as text, its long base64 runs replaced by markers. */
export function elideBase64Runs(line: Buffer): string {
  if (line.length < ELIDED_RUN_MIN_BYTES) {
    return line.toString('utf8')
  }
  let out = ''
  let outBytes = 0
  let copied = 0
  let at = 0
  while (at < line.length) {
    if (!BASE64_BYTE[line[at]]) {
      at++
      continue
    }
    let end = at + 1
    while (end < line.length && BASE64_BYTE[line[end]]) {
      end++
    }
    const digits = end - at
    while (digits >= RUN_PREFIX_BYTES && end < line.length && line[end] === PADDING) {
      end++
    }
    if (end - at >= ELIDED_RUN_MIN_BYTES) {
      const named = marker(at, end - at)
      out += line.toString('utf8', copied, at) + named
      outBytes += at - copied + named.length
      copied = end
    }
    at = end
  }
  if (outBytes + line.length - copied > SLIM_LINE_MAX_BYTES) {
    return ''
  }
  return copied === 0 ? line.toString('utf8') : out + line.toString('utf8', copied)
}

/**
 * The same elision for a host that is only a shell: an awk program over a byte window of the file
 * followed by one newline. It prints the bytes before the first line it kept, then each kept line as
 * `<its bytes in the file>\t<its text>`. `lead` is 1 when the window starts inside a line; `newest`
 * keeps the lines at the window's end; `budget` bounds the text printed.
 */
export const ELIDING_LINES_AWK = `
BEGIN {
  run = ""
  for (i = 0; i < ${RUN_PREFIX_BYTES}; i++) run = run "[A-Za-z0-9+/]"
}
function slim(s,   out, at, rest, n) {
  out = ""
  at = 0
  while (match(s, run)) {
    rest = substr(s, RSTART + ${RUN_PREFIX_BYTES})
    n = match(rest, /[^A-Za-z0-9+\\/]/) ? RSTART - 1 : length(rest)
    while (substr(rest, n + 1, 1) == "=") n++
    n += ${RUN_PREFIX_BYTES}
    RSTART = length(s) - length(rest) - ${RUN_PREFIX_BYTES - 1}
    if (n >= ${ELIDED_RUN_MIN_BYTES}) out = out substr(s, 1, RSTART - 1) "[base64 " n " bytes at " (at + RSTART - 1) "]"
    else out = out substr(s, 1, RSTART + n - 1)
    at += RSTART + n - 1
    s = substr(rest, n - ${RUN_PREFIX_BYTES - 1})
  }
  out = out s
  return length(out) > ${SLIM_LINE_MAX_BYTES} ? "" : out
}
{
  len[NR] = length($0)
  if (NR > lead) txt[NR] = slim($0)
}
END {
  first = 1 + lead
  last = NR - 1
  used = 0
  if (newest) {
    first = NR
    for (i = last; i > lead; i--) {
      used += length(txt[i])
      if (used > budget && i < last) break
      first = i
    }
  } else {
    for (i = first; i <= last; i++) {
      used += length(txt[i])
      if (used > budget) { last = i; break }
    }
  }
  skip = 0
  for (i = 1; i < first; i++) skip += len[i] + 1
  print skip
  for (i = first; i <= last; i++) print len[i] "\\t" txt[i]
}
`
