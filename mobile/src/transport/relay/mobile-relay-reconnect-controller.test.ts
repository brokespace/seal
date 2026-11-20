import { describe, expect, it, vi } from 'vitest'
import { RelayOuterError } from '../encryption/mobile-relay-e2ee-link'
import { defaultCancelTimer, defaultScheduleTimer } from '../../platform/timer-scheduler'
import { RelayReconnectController } from './mobile-relay-reconnect-controller'
import { relayHostReachabilityForFailure } from './relay-host-reachability-latch'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))

function controllerAfter(error: Error): RelayReconnectController {
  const controller = new RelayReconnectController(
    {
      now: () => 1_800_000_000_000,
      randomBytes: (length) => new Uint8Array(length),
      setTimer: defaultScheduleTimer,
      clearTimer: defaultCancelTimer
    },
    () => {}
  )
  controller.registerFailure(error, false)
  return controller
}

describe('RelayReconnectController credential gate', () => {
  it.each([
    ['a bare 4401 close from an older relay timing out the first frame', new RelayOuterError(4401)],
    ['a 4408 first-frame timeout', new RelayOuterError(4408, false, 'first frame timeout')]
  ])('retries on backoff after %s', (_name, error) => {
    const controller = controllerAfter(error)

    expect(controller.blocksUntilFreshCredential()).toBe(false)
    expect(relayHostReachabilityForFailure(error)).toBe('connecting')
  })

  it('waits for a fresh credential after a relay-hello 4401 refusal', () => {
    const error = new RelayOuterError(4401, true)
    const controller = controllerAfter(error)

    expect(controller.blocksUntilFreshCredential()).toBe(true)
    expect(relayHostReachabilityForFailure(error)).toBe('credential-refused')
  })
})
