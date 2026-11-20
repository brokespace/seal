// Replays an image-heavy Claude transcript through the code a chat view reads a remote session with,
// over a metered link, and reports round trips, wire bytes and time to first paint.
//
//   pnpm exec tsx config/scripts/performance/session-transcripts/live-transcript-replay-benchmark.ts
//     [--transcript <claude.jsonl>] [--rtt-ms 60] [--mbps 20] [--json <out.json>]
//
// Without --transcript it writes one in Claude Code's record shapes from image files in this repo.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { LiveTranscriptDelta } from '../../../../src/shared/live-sessions/live-session-types'
import { readTranscriptPage } from '../../../../src/main/live-sessions/transcripts/live-transcript-reader'
import { localTranscriptSource } from '../../../../src/main/live-sessions/transcripts/transcript-file-source'
import { writeImageHeavyClaudeTranscript } from './live-transcript-replay-corpus'
import {
  MeteredLink,
  REPLAY_DESKTOP_ID,
  REPLAY_PROVIDER_SESSION,
  REPLAY_SERVER_ID,
  replayDesktop,
  type ReplayRoute
} from './live-transcript-replay-link'

const { values: flags } = parseArgs({
  options: {
    transcript: { type: 'string' },
    'rtt-ms': { type: 'string', default: '60' },
    mbps: { type: 'string', default: '20' },
    json: { type: 'string' }
  }
})
const LINK = { rttMs: Number(flags['rtt-ms']), mbps: Number(flags.mbps) }

type Measured = {
  scenario: string
  route: ReplayRoute
  roundTrips: number
  wireBytes: number
  /** Deliveries that changed what the view shows. */
  updates: number
  firstPaintMs: number
  newestShownMs: number
  messagesShown: number
  inlineImageBytes: number
}

function inlineImageBytes(messages: LiveTranscriptDelta['messages']): number {
  let bytes = 0
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'image-ref' && block.url?.startsWith('data:')) {
        bytes += block.url.length
      }
    }
  }
  return bytes
}

/** The session is already listed: the view asks for the newest page. */
async function open(route: ReplayRoute, transcriptPath: string, newest: number): Promise<Measured> {
  const link = new MeteredLink(LINK)
  const { access, list } = replayDesktop(route, transcriptPath, link)
  list()
  const page = await access.page(REPLAY_DESKTOP_ID, null)
  const at = link.elapsedMs()
  if (!page.messages.some((message) => (message.transcriptOffset ?? 0) >= newest)) {
    throw new Error(`${route}: the newest page does not hold the newest message`)
  }
  return {
    scenario: 'open',
    route,
    roundTrips: link.roundTrips,
    wireBytes: link.bytes,
    updates: 1,
    firstPaintMs: at,
    newestShownMs: at,
    messagesShown: page.messages.length,
    inlineImageBytes: inlineImageBytes(page.messages)
  }
}

/**
 * The app restarted with the chat's tab open: the view reads and watches before the machine has
 * reconnected, then the machine lists the session.
 */
async function reconnect(
  route: ReplayRoute,
  transcriptPath: string,
  newest: number
): Promise<Measured> {
  const link = new MeteredLink(LINK)
  const { access, list } = replayDesktop(route, transcriptPath, link)
  const first = await access.page(REPLAY_DESKTOP_ID, null)
  const shown = new Map<string, number>()
  let updates = 0
  let firstPaintMs = Number.NaN
  let inline = 0
  let done: (ms: number) => void = () => {}
  const newestShown = new Promise<number>((resolve) => {
    done = resolve
  })
  const deliver = (delta: Pick<LiveTranscriptDelta, 'messages' | 'reset'>): void => {
    if (delta.messages.length === 0) {
      return
    }
    if (delta.reset) {
      shown.clear()
    }
    updates++
    inline += inlineImageBytes(delta.messages)
    firstPaintMs = Number.isNaN(firstPaintMs) ? link.elapsedMs() : firstPaintMs
    for (const message of delta.messages) {
      shown.set(message.id, message.transcriptOffset ?? 0)
    }
    if (delta.messages.some((message) => (message.transcriptOffset ?? 0) >= newest)) {
      done(link.elapsedMs())
    }
  }
  const watch = access.watch(REPLAY_DESKTOP_ID, first.cursor, deliver)
  void watch.ready.then((page) => page && deliver({ messages: page.messages, reset: true }))
  list()
  const newestShownMs = await newestShown
  watch.unsubscribe()
  return {
    scenario: 'reconnect',
    route,
    roundTrips: link.roundTrips,
    wireBytes: link.bytes,
    updates,
    firstPaintMs,
    newestShownMs,
    messagesShown: shown.size,
    inlineImageBytes: inline
  }
}

const megabytes = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} kB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`
const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)} s`

async function main(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'seal-transcript-replay-'))
  try {
    const transcriptPath = flags.transcript
      ? resolve(flags.transcript)
      : writeImageHeavyClaudeTranscript(join(scratch, `${REPLAY_PROVIDER_SESSION}.jsonl`))
    const lastPage = await readTranscriptPage(
      localTranscriptSource(transcriptPath),
      'claude',
      REPLAY_SERVER_ID,
      null,
      1
    )
    const newest = lastPage.messages.at(-1)?.transcriptOffset
    if (newest === undefined) {
      throw new Error('The transcript holds no message')
    }
    const transcript = {
      path: flags.transcript ? transcriptPath : '(generated)',
      bytes: statSync(transcriptPath).size,
      records: readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean).length
    }
    const results: Measured[] = []
    for (const route of ['host-script', 'server'] as const) {
      results.push(await reconnect(route, transcriptPath, newest))
      results.push(await open(route, transcriptPath, newest))
    }
    console.log(
      `transcript: ${megabytes(transcript.bytes)}, ${transcript.records} records; ` +
        `link: ${LINK.rttMs} ms round trip, ${LINK.mbps} Mbit/s`
    )
    console.table(
      results.map((result) => ({
        scenario: result.scenario,
        route: result.route,
        'round trips': result.roundTrips,
        'wire bytes': megabytes(result.wireBytes),
        'view updates': result.updates,
        'first paint': seconds(result.firstPaintMs),
        'newest shown': seconds(result.newestShownMs),
        messages: result.messagesShown,
        'inline image bytes': megabytes(result.inlineImageBytes)
      }))
    )
    if (flags.json) {
      writeFileSync(
        resolve(flags.json),
        `${JSON.stringify({ transcript, link: LINK, results }, null, 2)}\n`
      )
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// Transcript polls are unref'd timers; the run must outlive the waits between them.
const keepAlive = setInterval(() => {}, 1_000)
await main()
clearInterval(keepAlive)
