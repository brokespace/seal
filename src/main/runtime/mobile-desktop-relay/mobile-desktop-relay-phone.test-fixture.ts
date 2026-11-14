import { expect, vi } from 'vitest'
import WebSocket from 'ws'
import { z } from 'zod'
import { authenticatePairedE2EEV2TestClient } from '../rpc/mobile/e2ee/paired-e2ee-v2-test-client'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { OrcaRuntimeRpcServer } from '../rpc/server/runtime-rpc'

export const TARGET = 'runtime:env-1'
export type Frame = Record<string, unknown>

export function pair(
  server: OrcaRuntimeRpcServer,
  scope: 'mobile' | 'runtime',
  name: string
): PairingOffer {
  const offer = server.createPairingOffer({ address: '127.0.0.1', name, scope })
  if (!offer.available) {
    throw new Error('pairing unavailable')
  }
  return parsePairingCode(offer.pairingUrl)!
}

export async function connectPhone(
  desktop: OrcaRuntimeRpcServer,
  name: string,
  cleanups: (() => Promise<void> | void)[]
) {
  const pairing = pair(desktop, 'mobile', name)
  const ws = new WebSocket(pairing.endpoint)
  const frames: Frame[] = []
  const binaries: Uint8Array[] = []
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  const client = await authenticatePairedE2EEV2TestClient(ws, {
    hostPublicKeyB64: pairing.publicKeyB64,
    deviceToken: pairing.deviceToken
  })
  client.onBinary((bytes) => binaries.push(bytes))
  client.onText((plaintext) =>
    frames.push(z.record(z.string(), z.unknown()).parse(JSON.parse(plaintext)))
  )
  cleanups.push(() => ws.close())
  const token = pairing.deviceToken
  return {
    token,
    deviceId: pairing.pairedDeviceId!,
    frames,
    binaries,
    close: () => ws.close(),
    send(
      id: string,
      method: string,
      params: unknown,
      executionHost: string | null = TARGET,
      expectedRuntimeSource?: { sourceId: string; runtimeId: string },
      untrustedScope?: { callerScope: string; clientKind: string }
    ) {
      client.sendText(
        JSON.stringify({
          ...untrustedScope,
          id,
          deviceToken: token,
          method,
          params,
          executionHost: executionHost ?? undefined,
          ...(expectedRuntimeSource ? { expectedRuntimeSource } : {})
        })
      )
    },
    next: (id: string, predicate: (frame: Frame) => boolean = () => true) =>
      vi.waitFor(() => {
        const frame = frames.find((candidate) => candidate.id === id && predicate(candidate))
        expect(frame).toBeDefined()
        return frame!
      })
  }
}
