import { describe, expect, it, vi } from 'vitest'
import {
  bundle,
  FakeLogicalClient,
  FakeRelaySession,
  relay
} from '../connection/mobile-endpoint-supervisor-test-fakes'
import type { MobileEndpointSupervisorDependencies } from '../connection/mobile-endpoint-supervisor-contract'
import { RelayOuterError } from '../encryption/mobile-relay-e2ee-link'
import { defaultCancelTimer, defaultScheduleTimer } from '../../platform/timer-scheduler'
import { RelayReconnectController } from './mobile-relay-reconnect-controller'
import { MobileRelaySessionEstablisher } from './mobile-relay-session-establisher'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))

type OpenRelay = MobileEndpointSupervisorDependencies['openRelay']
type ResolveRelay = MobileEndpointSupervisorDependencies['resolveRelay']

const current = { token: 'A'.repeat(43), version: 2, expiresAt: Number.MAX_SAFE_INTEGER }
const grace = { token: 'G'.repeat(43), version: 1, expiresAt: Number.MAX_SAFE_INTEGER }

function establisherWith(args: {
  openRelay: OpenRelay
  storedRelay?: typeof relay
  resolveRelay?: ResolveRelay
}) {
  const controller = new RelayReconnectController(
    {
      now: () => 1_800_000_000_000,
      randomBytes: (length) => new Uint8Array(length),
      setTimer: defaultScheduleTimer,
      clearTimer: defaultCancelTimer
    },
    () => {}
  )
  const setRelayRouting = vi.fn(async () => {})
  const establisher = new MobileRelaySessionEstablisher({
    logical: new FakeLogicalClient('disconnected', 'lan'),
    controller,
    openRelay: args.openRelay,
    randomBytes: (length) => new Uint8Array(length),
    writeBundle: async () => {},
    isActive: () => true,
    isForeground: () => true,
    isStopped: () => false,
    hostId: 'host-1',
    relay: args.storedRelay ?? relay,
    resolveRelay: args.resolveRelay ?? (async (input) => input.relay),
    setRelayRouting,
    bundle: () => bundle,
    adoptBundle: () => {},
    recordMigration: () => {},
    scheduleLease: () => {},
    scheduleDirectProbe: () => {},
    onBookkeepingError: () => {},
    onDialFailure: () => {}
  })
  return { controller, establisher, setRelayRouting }
}

const failingWith = (error: Error) =>
  vi.fn<OpenRelay>(() => new FakeRelaySession('disconnected', error))

describe('MobileRelaySessionEstablisher credential verdicts', () => {
  it('keeps a credential whose dial ended in a bare 4401 close', async () => {
    const openRelay = failingWith(new RelayOuterError(4401))
    const { controller, establisher } = establisherWith({ openRelay })

    const result = await establisher.dialEligible([current, grace])

    expect(result).toMatchObject({ outcome: 'failed' })
    expect(openRelay.mock.calls.map(([, credential]) => credential.token)).toEqual(['A'.repeat(43)])
    expect(controller.eligibleCredentials(current)).toEqual([current])
  })

  it('retires a credential the relay refused in relay-hello and tries the grace one', async () => {
    const openRelay = failingWith(new RelayOuterError(4401, true))
    const { controller, establisher } = establisherWith({ openRelay })

    await establisher.dialEligible([current, grace])

    expect(openRelay.mock.calls.map(([, credential]) => credential.token)).toEqual([
      'A'.repeat(43),
      'G'.repeat(43)
    ])
    expect(controller.eligibleCredentials(current, grace)).toEqual([])
  })
})

describe('MobileRelaySessionEstablisher cell pin', () => {
  const strayRelay = { ...relay, cellUrl: 'https://cell.attacker.example' }

  it('never dials a stored cell outside the pin when the director cannot name a pinned one', async () => {
    const openRelay = vi.fn<OpenRelay>(() => new FakeRelaySession('connected'))
    const { establisher, setRelayRouting } = establisherWith({
      openRelay,
      storedRelay: strayRelay,
      resolveRelay: async () => {
        throw new Error('relay cell is outside the origins this host may use')
      }
    })

    await expect(establisher.dial(current)).resolves.toMatchObject({ ok: false })

    expect(openRelay).not.toHaveBeenCalled()
    expect(setRelayRouting).not.toHaveBeenCalled()
  })

  it('heals a stored cell outside the pin through the director before dialing', async () => {
    const openRelay = vi.fn<OpenRelay>(() => new FakeRelaySession('connected'))
    const { establisher, setRelayRouting } = establisherWith({
      openRelay,
      storedRelay: strayRelay,
      resolveRelay: async () => ({ ...relay, assignmentEpoch: 8 })
    })

    await expect(establisher.dial(current)).resolves.toEqual({ ok: true })

    expect(openRelay.mock.calls.map(([dialed]) => dialed.cellUrl)).toEqual([
      'https://relay.onorca.dev'
    ])
    expect(setRelayRouting).toHaveBeenCalledExactlyOnceWith('host-1', {
      ...relay,
      assignmentEpoch: 8
    })
  })
})
