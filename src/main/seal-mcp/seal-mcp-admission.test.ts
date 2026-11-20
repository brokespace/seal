import { describe, expect, it } from 'vitest'
import type { SealMcpClient } from '../../shared/seal-mcp/seal-mcp-types'
import { SealMcpAdmissionDoor, type SealMcpPeer } from './seal-mcp-admission'

const VALID = 'valid-token'
const client: SealMcpClient = {
  id: 'client-1',
  name: 'client',
  scopes: [],
  machines: null,
  approval: 'never',
  allowRelay: true,
  callsPerMinute: 60,
  createdAt: 0,
  lastUsedAt: null,
  revokedAt: null
}

function door(): SealMcpAdmissionDoor {
  return new SealMcpAdmissionDoor({
    settings: () => ({ httpEnabled: true, relayEnabled: true }),
    authenticate: (token) => (token === VALID ? client : null),
    refused: () => {}
  })
}

const relayPeer = (remote: string): SealMcpPeer => ({ transport: 'relay', remote })

describe('SealMcpAdmissionDoor', () => {
  it('counts failed sign-ins from every address of one IPv6 /64 together', () => {
    const admission = door()
    for (let i = 1; i <= 20; i++) {
      admission.admit('wrong', relayPeer(`2001:db8:1:2::${i.toString(16)}`))
    }

    expect(admission.admit(VALID, relayPeer('2001:db8:1:2::ffff'))).toMatchObject({
      ok: false,
      reason: 'throttled'
    })
    expect(admission.admit(VALID, relayPeer('2001:db8:1:3::1'))).toMatchObject({ ok: true })
  })

  it('still admits a caller who never failed while thousands of other addresses are failing', () => {
    const admission = door()
    for (let i = 0; i < 5000; i++) {
      admission.admit('wrong', relayPeer(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`))
    }

    expect(admission.admit(VALID, relayPeer('192.0.2.7'))).toMatchObject({ ok: true })
  })
})
