import { describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { MobileSocketWiring } from '../../rpc/mobile/mobile-socket-wiring'
import { RelayOriginPool } from './relay-origin-pool'

function poolWith(allowedCellOrigins: readonly string[]) {
  const createControlSocket = vi.fn((_url: string, _relayJwt: string): WebSocket => {
    throw new Error('control-socket-dialed')
  })
  const createDataSocket = vi.fn((_url: string): WebSocket => {
    throw new Error('data-socket-dialed')
  })
  const keys = { publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) }
  const pool = new RelayOriginPool({
    directorUrl: 'https://relay.example',
    allowedCellOrigins,
    relayHostId: 'AbCdEf0123_-xyZ9',
    identity: { userId: 'user-1', profileId: 'profile-1', organizationId: 'org-1' },
    keypair: { ...keys, publicKeyB64: Buffer.from(keys.publicKey).toString('base64') },
    appVersion: '1.2.3',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pool only attaches its transport to the wiring.
    mobileSocketWiring: { attachTransport: () => () => {} } as unknown as MobileSocketWiring,
    isCurrent: () => true,
    onStatus: () => {},
    createControlSocket,
    createDataSocket
  })
  return { pool, createControlSocket, createDataSocket }
}

const assignmentTo = (cellUrl: string) => ({
  v: 1 as const,
  cellUrl,
  assignmentEpoch: 4,
  lease: 'lease-jwt'
})

describe('RelayOriginPool cell pin', () => {
  it('never dials a cell outside the pin or hands it the relay JWT', async () => {
    const { pool, createControlSocket, createDataSocket } = poolWith([])

    await expect(
      pool.openInitial(assignmentTo('https://cell.attacker.example'), 'relay-jwt')
    ).rejects.toMatchObject({ message: 'relay_assignment_failed_502', statusCode: 502 })

    expect(createControlSocket).not.toHaveBeenCalled()
    expect(createDataSocket).not.toHaveBeenCalled()
    expect(pool.activeAssignment).toBeNull()
  })

  it('dials the director origin with the relay JWT', async () => {
    const { pool, createControlSocket } = poolWith([])

    await expect(
      pool.openInitial(assignmentTo('https://relay.example'), 'relay-jwt')
    ).rejects.toThrow('control-socket-dialed')

    expect(createControlSocket).toHaveBeenCalledExactlyOnceWith(
      'wss://relay.example/v1/host/control',
      'relay-jwt'
    )
  })
})
