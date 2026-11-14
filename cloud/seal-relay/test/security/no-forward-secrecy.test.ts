import nacl from 'tweetnacl'
import { expect, it } from 'vitest'
import { decrypt, deriveSharedKey, encrypt } from '../../../../src/shared/remote-runtime/e2ee/node/e2ee-crypto'
import { describePoc } from './poc-opt-in'

// The host identity key (orca-e2ee-keypair.json) is static and long-lived, and both E2EE schemes
// derive the session key from an X25519 agreement with it. There is no ephemeral host key, so a
// later disclosure of that one file decrypts every recorded session — including the bearer token
// the phone sends in e2ee_auth, which by itself is a shell credential on the direct transport.
describePoc('PoC E2EE-02: the static host key gives the whole transcript no forward secrecy', () => {
  it('a passive legacy capture plus the host secret recovers the device bearer token', () => {
    const host = nacl.box.keyPair()
    const phone = nacl.box.keyPair()

    // What a passive observer (relay operator, or anyone who logged ciphertext) sees on the wire.
    const captured = {
      helloPublicKeyB64: Buffer.from(phone.publicKey).toString('base64'),
      authFrame: encrypt(
        JSON.stringify({ type: 'e2ee_auth', deviceToken: 'c0ffee'.repeat(8) }),
        deriveSharedKey(phone.secretKey, host.publicKey)
      )
    }

    // Months later, host.secretKey leaks (backup, stolen laptop, malware). No phone key needed.
    const recoveredKey = deriveSharedKey(
      host.secretKey,
      Uint8Array.from(Buffer.from(captured.helloPublicKeyB64, 'base64'))
    )
    const recovered = JSON.parse(decrypt(captured.authFrame, recoveredKey)!)
    expect(recovered.deviceToken).toBe('c0ffee'.repeat(8))
  })
})
