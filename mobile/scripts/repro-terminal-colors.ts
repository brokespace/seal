/**
 * Minimal mobile terminal color repro.
 *
 * Captures terminal.subscribe snapshots in the same sequence that tab switching
 * uses: terminal A, terminal B, terminal A again. The report tells us whether
 * ANSI SGR color attributes disappeared in the desktop serialized scrollback
 * or are still present and therefore being lost during mobile WebView replay.
 *
 * Usage:
 *   ORCA_MOBILE_WS_URL=ws://127.0.0.1:6768 \
 *     pnpm exec tsx scripts/repro-terminal-colors.ts <deviceToken> <serverPublicKeyB64> <worktreeSelector> [handleA] [handleB]
 */
import WebSocket from 'ws'
import {
  authenticatePairedE2EEV2TestClient,
  type PairedE2EEV2TestClient
} from '../../src/main/runtime/rpc/mobile/e2ee/paired-e2ee-v2-test-client'
import {
  saveTerminalColorSnapshots,
  summarizeTerminalColorSnapshot,
  type TerminalColorSnapshot
} from './repro-terminal-color-output'

const WS_URL = process.env.ORCA_MOBILE_WS_URL ?? 'ws://127.0.0.1:6768'
const token = process.argv[2]
const serverPublicKeyB64 = process.argv[3]
const worktreeSelector = process.argv[4]
const explicitHandleA = process.argv[5]
const explicitHandleB = process.argv[6]

type RpcResponse = {
  id: string
  ok: boolean
  streaming?: true
  result?: Record<string, unknown>
  error?: { code: string; message: string }
}

type PendingRequest = {
  method: string
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
}

if (!token || !serverPublicKeyB64 || !worktreeSelector) {
  console.error(
    'Usage: pnpm exec tsx scripts/repro-terminal-colors.ts <deviceToken> <serverPublicKeyB64> <worktreeSelector> [handleA] [handleB]'
  )
  process.exit(1)
}

let reqId = 0
const pending = new Map<string, PendingRequest>()
const streamListeners = new Map<string, (result: Record<string, unknown>) => void>()
// Why per socket: a v2 frame opens once, in order, so one owner reads each socket.
const channels = new WeakMap<WebSocket, PairedE2EEV2TestClient>()

function nextId(): string {
  reqId += 1
  return `color-repro-${reqId}`
}

function sendRaw(ws: WebSocket, payload: unknown): void {
  const channel = channels.get(ws)
  if (!channel) {
    throw new Error('Socket is not authenticated yet')
  }
  channel.sendText(JSON.stringify(payload))
}

function send(ws: WebSocket, method: string, params?: unknown): Promise<RpcResponse> {
  const id = nextId()
  sendRaw(ws, { id, deviceToken: token, method, params })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      streamListeners.delete(id)
      reject(new Error(`Timed out waiting for ${method}`))
    }, 10_000)
    pending.set(id, {
      method,
      resolve: (response) => {
        clearTimeout(timeout)
        resolve(response)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
  })
}

function formatError(response: RpcResponse): string {
  return JSON.stringify(response.error ?? response.result ?? response).slice(0, 1000)
}

async function listHandles(
  ws: WebSocket
): Promise<Array<{ handle: string; title: string | null }>> {
  const response = await send(ws, 'terminal.list', { worktree: worktreeSelector })
  if (!response.ok) {
    throw new Error(`terminal.list failed: ${formatError(response)}`)
  }
  return (
    (response.result?.terminals ?? []) as Array<{ handle: string; title?: string | null }>
  ).map((terminal) => ({
    handle: terminal.handle,
    title: terminal.title ?? null
  }))
}

async function ensureSecondHandle(ws: WebSocket, handleA: string): Promise<string> {
  const terminals = await listHandles(ws)
  const existing = terminals.find((terminal) => terminal.handle !== handleA)
  if (existing) {
    return existing.handle
  }

  const created = await send(ws, 'terminal.create', {
    worktree: worktreeSelector,
    title: 'color-repro-switch-target'
  })
  if (!created.ok) {
    throw new Error(`terminal.create failed: ${formatError(created)}`)
  }
  const handle = (created.result?.terminal as { handle?: string } | undefined)?.handle
  if (!handle) {
    throw new Error(`terminal.create returned no handle: ${formatError(created)}`)
  }
  return handle
}

async function captureSnapshot(
  ws: WebSocket,
  label: string,
  handle: string
): Promise<TerminalColorSnapshot> {
  const id = nextId()
  const snapshot = await new Promise<TerminalColorSnapshot>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      streamListeners.delete(id)
      reject(new Error(`Timed out waiting for scrollback snapshot ${label}`))
    }, 10_000)

    pending.set(id, {
      method: 'terminal.subscribe',
      resolve: () => {},
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
    streamListeners.set(id, (result) => {
      if (result.type !== 'scrollback') {
        return
      }
      clearTimeout(timeout)
      pending.delete(id)
      streamListeners.delete(id)
      const serialized = typeof result.serialized === 'string' ? result.serialized : ''
      const rawLines = result.lines
      const lines = Array.isArray(rawLines) ? rawLines.join('\n') : String(rawLines ?? '')
      resolve({
        label,
        handle,
        cols: typeof result.cols === 'number' ? result.cols : null,
        rows: typeof result.rows === 'number' ? result.rows : null,
        serialized,
        lines
      })
    })

    sendRaw(ws, {
      id,
      deviceToken: token,
      method: 'terminal.subscribe',
      params: { terminal: handle }
    })
  })

  await send(ws, 'terminal.unsubscribe', { subscriptionId: handle }).catch(() => null)
  return snapshot
}

async function run(ws: WebSocket): Promise<void> {
  const channel = await authenticatePairedE2EEV2TestClient(ws, {
    hostPublicKeyB64: serverPublicKeyB64,
    deviceToken: token
  })
  channels.set(ws, channel)
  channel.onText(handleHostText)

  const terminals = await listHandles(ws)
  if (terminals.length === 0 && !explicitHandleA) {
    throw new Error('No terminals found. Open a Claude Code terminal first, then rerun.')
  }

  const handleA = explicitHandleA ?? terminals[0]!.handle
  const handleB = explicitHandleB ?? (await ensureSecondHandle(ws, handleA))

  console.log(`A: ${handleA}`)
  console.log(`B: ${handleB}`)

  const firstA = await captureSnapshot(ws, 'a-before-switch', handleA)
  const firstB = await captureSnapshot(ws, 'b-during-switch', handleB)
  const secondA = await captureSnapshot(ws, 'a-after-switch', handleA)
  const snapshots = [firstA, firstB, secondA]
  const dir = saveTerminalColorSnapshots(snapshots)

  console.table(snapshots.map(summarizeTerminalColorSnapshot))
  console.log(`saved: ${dir}`)
  if (
    summarizeTerminalColorSnapshot(firstA).sgrColor !==
    summarizeTerminalColorSnapshot(secondA).sgrColor
  ) {
    console.log(
      'color SGR count changed between A snapshots: serialization/state changed on desktop'
    )
  } else {
    console.log('A snapshots have the same color SGR count: likely mobile replay/render path')
  }
}

const ws = new WebSocket(WS_URL)

ws.on('open', () => {
  run(ws)
    .then(() => {
      ws.close()
      process.exit(0)
    })
    .catch((error) => {
      console.error(error.message)
      ws.close()
      process.exit(1)
    })
})

function handleHostText(plaintext: string): void {
  const response = JSON.parse(plaintext) as RpcResponse
  const result = response.result
  const streamListener = streamListeners.get(response.id)
  if (streamListener && response.ok && (response.streaming || result?.type === 'scrollback')) {
    streamListener(result ?? {})
    return
  }

  const request = pending.get(response.id)
  if (!request || request.method === 'terminal.subscribe') {
    return
  }
  pending.delete(response.id)
  request.resolve(response)
}

ws.on('close', () => {
  for (const request of pending.values()) {
    request.reject(new Error('WebSocket closed'))
  }
  pending.clear()
})

ws.on('error', (error) => {
  console.error(`WebSocket error: ${error.message}`)
  process.exit(1)
})
