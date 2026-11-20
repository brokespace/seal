#!/usr/bin/env npx tsx
// Standalone E2EE WebSocket mock exposes desktop RPCs with fake data for mobile development without Orca.
import { WebSocketServer, type WebSocket } from 'ws'
import { DesktopMobileE2EEV2Session } from '../../src/main/runtime/rpc/mobile/e2ee/mobile-e2ee-v2-desktop-session'
import { loadOrCreateMockServerKeyPair } from './mock-server-key-pair'
import {
  error,
  handleRequest,
  mockScenarioSummary,
  type RpcRequest
} from './mock-server-rpc-handlers'

const PORT = Number(process.env.PORT) || 6768
const AUTH_TOKEN = 'mock-device-token'

// Print server public key for pairing QR; MOCK_SERVER_KEY_FILE preserves it across restarts for pinned devices.
const serverKeyPair = loadOrCreateMockServerKeyPair(process.env.MOCK_SERVER_KEY_FILE)
const serverPublicKeyB64 = Buffer.from(serverKeyPair.publicKey).toString('base64')

const wss = new WebSocketServer({ port: PORT })

// First frame is the plaintext v2 hello; every later frame is sealed under that socket's session keys.
type MockSocketState = { session: DesktopMobileE2EEV2Session; authenticated: boolean }
const connectionState = new Map<WebSocket, MockSocketState>()

wss.on('connection', (ws) => {
  console.log('[mock] Client connected — waiting for e2ee_hello')

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      return
    }
    const msg = data.toString('utf-8')
    const state = connectionState.get(ws)

    if (!state) {
      let hello: unknown
      try {
        hello = JSON.parse(msg)
      } catch {
        ws.close(4001, 'Invalid handshake message')
        return
      }
      const session = DesktopMobileE2EEV2Session.create({
        hello,
        serverSecretKey: serverKeyPair.secretKey,
        expectedContext: { transport: 'direct' }
      })
      if (!session) {
        // Same refusal as a real desktop: nothing older than forward-secret v2 is answered.
        ws.close(4001, 'Invalid e2ee_hello v2')
        return
      }
      connectionState.set(ws, { session, authenticated: false })
      ws.send(JSON.stringify(session.ready))
      console.log('[mock] E2EE key exchange complete — waiting for encrypted auth')
      return
    }

    const { session } = state
    const plaintext = session.openText(msg)
    if (plaintext === null) {
      console.log('[mock] Decryption failed — dropping message')
      return
    }

    let request: RpcRequest
    try {
      request = JSON.parse(plaintext) as RpcRequest
    } catch {
      ws.send(session.sealText(JSON.stringify(error('unknown', 'bad_request', 'Invalid JSON'))))
      return
    }

    if (!state.authenticated) {
      const auth: Record<string, unknown> = { ...request }
      if (
        auth.type !== 'e2ee_auth' ||
        auth.deviceToken !== AUTH_TOKEN ||
        auth.transcriptHashB64 !== session.transcriptHashB64
      ) {
        ws.send(
          session.sealText(JSON.stringify({ type: 'e2ee_error', error: { code: 'unauthorized' } }))
        )
        ws.close()
        return
      }
      state.authenticated = true
      ws.send(
        session.sealText(
          JSON.stringify({
            type: 'e2ee_authenticated',
            v: 2,
            transcriptHashB64: session.transcriptHashB64
          })
        )
      )
      console.log('[mock] E2EE authentication complete')
      return
    }

    console.log(`[mock] ${request.method} (id: ${request.id})`)
    handleRequest(
      request,
      (response) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(session.sealText(JSON.stringify(response)))
        }
      },
      ws
    )
  })

  ws.on('close', () => {
    connectionState.delete(ws)
    console.log('[mock] Client disconnected')
  })

  ws.on('error', () => {
    connectionState.delete(ws)
    ws.close()
  })
})

console.log(`[mock] Seal mock server listening on ws://localhost:${PORT}`)
console.log(`[mock] Auth token: ${AUTH_TOKEN}`)
console.log(`[mock] Server public key (base64): ${serverPublicKeyB64}`)
console.log(
  `[mock] Scenario: ${mockScenarioSummary.repoCount} repos, ${mockScenarioSummary.worktreeCount} worktrees, ${mockScenarioSummary.rpcDelayMs}ms default RPC delay`
)
console.log(`[mock] E2EE enabled — clients must send e2ee_hello before RPC`)
