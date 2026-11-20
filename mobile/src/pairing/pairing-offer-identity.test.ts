import { describe, expect, it } from 'vitest'
import type { PairingOffer } from '../../../src/shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { describePairingOfferIdentity } from './pairing-offer-identity'

const directOffer: PairingOffer = {
  v: 2,
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA='
}

function relayOffer(directorUrl: string): PairingOffer {
  return {
    ...directOffer,
    relay: {
      v: 1,
      directorUrl,
      cellUrl: directorUrl,
      assignmentEpoch: 7,
      relayHostId: 'riFsLvUkejeCwTXv',
      inviteToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGH012345678',
      inviteExpiresAt: 1_800_000_300_000,
      e2eeFraming: 2
    }
  }
}

describe('describePairingOfferIdentity', () => {
  it('shows the key fingerprint and direct address of a code for a computer not paired yet', () => {
    expect(describePairingOfferIdentity(directOffer, [])).toEqual({
      knownHostName: null,
      fingerprint: 'riFs LvUk ejeC wTXv',
      relayOrigin: null,
      usesOtherRelay: false,
      directEndpoint: 'ws://192.168.1.10:6768'
    })
  })

  it('names the paired computer a code with the same key would replace', () => {
    const identity = describePairingOfferIdentity(directOffer, [
      { name: 'Blue Whale', publicKeyB64: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=' },
      { name: 'Grey Seal', publicKeyB64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=' }
    ])

    expect(identity.knownHostName).toBe('Grey Seal')
  })

  it('flags a relay other than the one this build ships with', () => {
    expect(
      describePairingOfferIdentity(relayOffer('https://relay.seal.wotarmelon.com'), [])
    ).toMatchObject({ relayOrigin: 'https://relay.seal.wotarmelon.com', usesOtherRelay: false })
    expect(describePairingOfferIdentity(relayOffer('https://relay.example'), [])).toMatchObject({
      relayOrigin: 'https://relay.example',
      usesOtherRelay: true
    })
  })

  it('has no fingerprint for a key that is not 32 bytes', () => {
    expect(
      describePairingOfferIdentity({ ...directOffer, publicKeyB64: 'pubkey-xyz' }, []).fingerprint
    ).toBeNull()
  })
})
