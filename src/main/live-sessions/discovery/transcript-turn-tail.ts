// The end of a transcript as far as a turn's own records go. Claude Code also logs each API
// request there (its shape, its blobs, a snapshot of the prompt and every tool): tens of
// kilobytes that would push the turn's records out of the bytes a scan reads.

/** What a line holds that is one of those logs; JSON escapes quotes inside strings, so only a record's own keys match. */
export const TRANSCRIPT_LOG_MARKS = [
  '{"type":"api-request',
  '"attachment":{"type":"prompt_snapshot"'
] as const

/** How much more of the file is read before those logs are dropped and the tail is cut to size. */
export const TURN_TAIL_WINDOW_FACTOR = 8

/** The last `tailBytes` of `window` once the request logs are out of it. */
export function turnTail(window: string, tailBytes: number): string {
  const kept = window
    .split('\n')
    .filter((line) => !TRANSCRIPT_LOG_MARKS.some((mark) => line.includes(mark)))
    .join('\n')
  const bytes = Buffer.from(kept, 'utf8')
  return bytes.length <= tailBytes
    ? kept
    : bytes.subarray(bytes.length - tailBytes).toString('utf8')
}
