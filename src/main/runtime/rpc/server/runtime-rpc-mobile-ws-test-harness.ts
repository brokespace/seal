import { expect } from 'vitest'
import WebSocket from 'ws'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import {
  authenticatePairedE2EEV2TestClient,
  type PairedE2EEV2TestClient
} from '../mobile/e2ee/paired-e2ee-v2-test-client'

export function connectWs(endpoint: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

export function waitForWsClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) {
      resolve()
      return
    }
    ws.once('close', () => resolve())
  })
}

export type AuthenticatedMobileWs = PairedE2EEV2TestClient

export async function authenticateMobileWsSession(
  pairingUrl: string
): Promise<AuthenticatedMobileWs> {
  const parsed = parsePairingCode(pairingUrl)
  expect(parsed).toBeTruthy()
  const ws = await connectWs(parsed!.endpoint)
  return authenticatePairedE2EEV2TestClient(ws, {
    hostPublicKeyB64: parsed!.publicKeyB64,
    deviceToken: parsed!.deviceToken
  })
}

export async function authenticateMobileWs(pairingUrl: string): Promise<WebSocket> {
  return (await authenticateMobileWsSession(pairingUrl)).ws
}

export function sendEncryptedWsRequest(
  session: AuthenticatedMobileWs,
  request: Record<string, unknown>
): void {
  session.sendText(JSON.stringify(request))
}

export function createEncryptedWsResponseReader(session: AuthenticatedMobileWs): {
  next: (
    id: string,
    predicate?: (response: Record<string, unknown>) => boolean
  ) => Promise<Record<string, unknown>>
  dispose: () => void
} {
  type Waiter = {
    id: string
    predicate: (response: Record<string, unknown>) => boolean
    resolve: (response: Record<string, unknown>) => void
  }
  const queue: Record<string, unknown>[] = []
  const waiters: Waiter[] = []

  const takeQueued = (
    id: string,
    predicate: (response: Record<string, unknown>) => boolean
  ): Record<string, unknown> | null => {
    const index = queue.findIndex((response) => response.id === id && predicate(response))
    if (index === -1) {
      return null
    }
    const [response] = queue.splice(index, 1)
    return response ?? null
  }

  const onMessage = (plaintext: string): void => {
    const response = JSON.parse(plaintext) as Record<string, unknown>
    const waiterIndex = waiters.findIndex(
      (waiter) => response.id === waiter.id && waiter.predicate(response)
    )
    if (waiterIndex === -1) {
      queue.push(response)
      return
    }
    const [waiter] = waiters.splice(waiterIndex, 1)
    waiter?.resolve(response)
  }

  const unsubscribe = session.onText(onMessage)

  return {
    next: (id: string, predicate: (response: Record<string, unknown>) => boolean = () => true) => {
      const queued = takeQueued(id, predicate)
      if (queued) {
        return Promise.resolve(queued)
      }
      return new Promise<Record<string, unknown>>((resolve) => {
        waiters.push({ id, predicate, resolve })
      })
    },
    dispose: () => {
      unsubscribe()
      waiters.length = 0
      queue.length = 0
    }
  }
}
