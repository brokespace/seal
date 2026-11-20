import { describe, expect, it } from 'vitest'
import { sealMobileE2EEV2Frame } from './e2ee/mobile-e2ee-v2-framing'
import {
  REMOTE_RUNTIME_MAX_INBOUND_FRAME_BYTES,
  REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES
} from './remote-runtime-memory-limits'

describe('remote runtime memory limits', () => {
  it('seals the largest admitted request JSON within the host inbound frame', () => {
    const json = 'x'.repeat(REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES)
    const key = new Uint8Array(32).fill(1)
    const frame = Buffer.from(
      sealMobileE2EEV2Frame({
        payload: new TextEncoder().encode(json),
        key,
        sessionId: new Uint8Array(32).fill(2),
        direction: 'mobile-to-desktop',
        payloadKind: 'text',
        counter: 0n
      })
    ).toString('base64')
    expect(frame.length).toBeLessThanOrEqual(REMOTE_RUNTIME_MAX_INBOUND_FRAME_BYTES)
  })
})
