// The desktop's transcript access to one session on a remote machine, over a link that counts what
// crosses it and models the time that takes.
import { performance } from 'node:perf_hooks'
import { COMPRESSED_FRAMES_CLIENT_CAPABILITY } from '../../../../src/shared/remote-runtime/e2ee/paired-e2ee-compressed-frame'
import type { LiveSession } from '../../../../src/shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../../src/shared/live-sessions/live-session-surface.test-fixture'
import { FederatedTranscripts } from '../../../../src/main/live-sessions/federation/federated-transcripts'
import type { FederationTransport } from '../../../../src/main/live-sessions/federation/federation-transport'
import { runLiveSessionHostScript } from '../../../../src/main/live-sessions/hosts/live-session-host-run'
import type { LiveSessionHost } from '../../../../src/main/live-sessions/hosts/live-session-hosts'
import { SessionTranscriptAccess } from '../../../../src/main/live-sessions/session-transcript-access'
import { LiveTranscriptStreams } from '../../../../src/main/live-sessions/transcripts/live-transcript-streams'
import { isCompressibleReplyRequest } from '../../../../src/main/runtime/rpc/mobile/e2ee/mobile-e2ee-compressible-reply-methods'
import { compressMobileE2EEV2Item } from '../../../../src/main/runtime/rpc/mobile/e2ee/mobile-e2ee-v2-compressed-frame'

const HOST_ID = 'machine-2299'
const SERVER_ENVIRONMENT = 'env-2299'
export const REPLAY_PROVIDER_SESSION = '7d1c3a52-8f0e-4c55-9a43-2b6f1e0d9c11'
export const REPLAY_DESKTOP_ID = `${HOST_ID}:claude:${REPLAY_PROVIDER_SESSION}`
export const REPLAY_SERVER_ID = `local:claude:${REPLAY_PROVIDER_SESSION}`
/** A sealed frame adds a 24-byte nonce, a 16-byte MAC and a 42-byte header. */
const SEAL_BYTES = 82
// A wait of this fraction is a poll between transcript reads: counted, not slept.
const POLL_MARK = 0.25
const POLL_MS = { local: 500 + POLL_MARK, ssh: 1_500 + POLL_MARK }

/** The link between the desktop and the machine: what crossed it, and the time that took. */
export class MeteredLink {
  roundTrips = 0
  bytes = 0
  /** Time the run did not spend but the link and the polls would have. */
  private modeledMs = 0
  private readonly startedAt = performance.now()

  constructor(private readonly shape: { rttMs: number; mbps: number }) {
    polled = (ms) => {
      this.modeledMs += ms
    }
  }

  elapsedMs(): number {
    return performance.now() - this.startedAt + this.modeledMs
  }

  private sent(plaintextBytes: number, sealedAs: 'text' | 'binary'): void {
    // Text frames are sealed then base64'd; a compressed frame travels as binary.
    const bytes =
      sealedAs === 'text'
        ? Math.ceil((plaintextBytes + SEAL_BYTES) / 3) * 4
        : plaintextBytes + SEAL_BYTES
    this.bytes += bytes
    this.modeledMs += bytes / ((this.shape.mbps * 1_000_000) / 8 / 1000)
  }

  /** One frame from the server, sealed as the runtime's E2EE channel seals a reply to `request`. */
  reply(request: string, reply: unknown): void {
    const item = compressMobileE2EEV2Item(
      { kind: 'text', plaintext: JSON.stringify(reply) },
      [COMPRESSED_FRAMES_CLIENT_CAPABILITY],
      isCompressibleReplyRequest(request) ? { compressible: true } : undefined
    )
    this.sent(Buffer.byteLength(item.plaintext), item.kind)
  }

  request(request: string): void {
    this.roundTrips++
    this.modeledMs += this.shape.rttMs
    this.sent(Buffer.byteLength(request), 'text')
  }
}

/** Tells the link being measured of a poll wait. */
let polled: (ms: number) => void = () => {}

const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = ((handler: () => void, ms?: number, ...rest: unknown[]) => {
  if (ms !== undefined && Math.abs((ms % 1) - POLL_MARK) < 1e-6) {
    polled(ms)
    return realSetTimeout(handler, 0)
  }
  return realSetTimeout(handler, ms, ...rest)
}) as typeof setTimeout

function session(id: string, machine: LiveSession['machine'], transcriptPath: string): LiveSession {
  return {
    id,
    provider: 'claude',
    providerSessionId: REPLAY_PROVIDER_SESSION,
    machine,
    origin: 'external',
    ...sampleSessionSurface('external'),
    cwd: '/home/brian/app',
    project: 'app',
    title: null,
    status: 'your-turn',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 0,
    startedAt: null,
    alive: true,
    pid: 4321,
    transcriptPath,
    inputRoutes: [],
    permission: null
  }
}

/**
 * `host-script`: the transcript file read through shell scripts, as over SSH and from a server that
 * predates serving its own sessions. `server`: a paired Seal server reads it and sends rows.
 */
export type ReplayRoute = 'host-script' | 'server'

/** The desktop's transcript access to one session on a paired server, which lists it once `listed`. */
export function replayDesktop(route: ReplayRoute, transcriptPath: string, link: MeteredLink) {
  let listed = false
  const told = new Set<() => void>()

  // The server: its own registry lists the session as `local`, and it reads the file from disk.
  const onServer = session(
    REPLAY_SERVER_ID,
    { hostId: 'local', label: '2299', kind: 'local', connection: 'local' },
    transcriptPath
  )
  const serverStreams = new LiveTranscriptStreams(
    { get: (id) => (id === REPLAY_SERVER_ID ? onServer : null), host: () => serverHost },
    { pollMs: POLL_MS }
  )
  const serverHost: LiveSessionHost = { machine: onServer.machine, run: async () => '' }
  const serverAccess = new SessionTranscriptAccess({
    session: (id) => (id === REPLAY_SERVER_ID ? onServer : null),
    server: () => null,
    files: serverStreams,
    onSessionsChanged: () => () => {}
  })

  const transport: FederationTransport = {
    async call(_environmentId, method, params, _timeoutMs) {
      const request = JSON.stringify({ id: 'r', deviceToken: 't', method, params })
      link.request(request)
      const args = params as { sessionId: string; before?: number | null; limit?: number }
      const result =
        method === 'liveSessions.transcript'
          ? await serverAccess.page(args.sessionId, args.before ?? null, args.limit)
          : null
      const response = { id: 'r', ok: true as const, result }
      link.reply(request, response)
      return response as Awaited<ReturnType<FederationTransport['call']>>
    },
    async subscribe(_environmentId, method, params, handlers) {
      const request = JSON.stringify({ id: 's', deviceToken: 't', method, params })
      link.request(request)
      const args = params as { sessionId: string; fromCursor?: number | null }
      const frame = (result: unknown): void => {
        link.reply(request, { id: 's', ok: true, streaming: true, result })
        handlers.onFrame(result)
      }
      const subscription = serverAccess.watch(args.sessionId, args.fromCursor ?? null, (delta) =>
        frame({ type: 'delta', delta })
      )
      void subscription.ready.then((page) => frame({ type: 'ready', subscriptionId: 's', page }))
      return { close: () => subscription.unsubscribe() }
    }
  }
  const federated = new FederatedTranscripts({
    transport,
    target: (id) =>
      listed && id === REPLAY_DESKTOP_ID
        ? { environmentId: SERVER_ENVIRONMENT, sessionId: REPLAY_SERVER_ID }
        : null,
    retryMs: 2_000 + POLL_MARK
  })

  // The desktop's own record of it, read through the server's `liveSessions.hostRun`.
  const onDesktop = session(
    REPLAY_DESKTOP_ID,
    { hostId: HOST_ID, label: '2299', kind: 'remote', connection: 'server' },
    transcriptPath
  )
  const hostRun: LiveSessionHost = {
    machine: onDesktop.machine,
    async run(script, options) {
      const params = { script, timeoutMs: options?.timeoutMs ?? 20_000 }
      const request = JSON.stringify({
        id: 'h',
        deviceToken: 't',
        method: 'liveSessions.hostRun',
        params
      })
      link.request(request)
      const result = await runLiveSessionHostScript(params)
      link.reply(request, { id: 'h', ok: true, result })
      return result.stdout
    }
  }
  const streams = new LiveTranscriptStreams(
    { get: (id) => (listed && id === REPLAY_DESKTOP_ID ? onDesktop : null), host: () => hostRun },
    { pollMs: POLL_MS }
  )
  const access = new SessionTranscriptAccess({
    session: (id) => (listed && id === REPLAY_DESKTOP_ID ? onDesktop : null),
    server: (id) => (route === 'server' && listed && id === REPLAY_DESKTOP_ID ? federated : null),
    files: streams,
    onSessionsChanged: (listener) => {
      told.add(listener)
      return () => told.delete(listener)
    }
  })
  return {
    access,
    list: () => {
      listed = true
      for (const listener of told) {
        listener()
      }
    }
  }
}
