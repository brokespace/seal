import { beforeEach, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value)
    }
  }
}))
import { rememberPushDismissals, wasPushDismissed } from './push-dismissal-watermarks'

beforeEach(() => storage.clear())

function fence(index: number) {
  return {
    hostFingerprint: 'host-a',
    notificationEpoch: 'epoch-a',
    notificationId: `note-${index}`,
    notificationSeq: 1
  }
}

it('keeps the newest 1024 dismissals and forgets the oldest beyond that', async () => {
  await rememberPushDismissals(Array.from({ length: 1025 }, (_, index) => fence(index)))

  expect(await wasPushDismissed(fence(0))).toBe(false)
  expect(await wasPushDismissed(fence(1))).toBe(true)
  expect(await wasPushDismissed(fence(1024))).toBe(true)
})

it('a dismissal seen again counts as new and outlives older ones at the cap', async () => {
  await rememberPushDismissals(Array.from({ length: 1024 }, (_, index) => fence(index)))
  await rememberPushDismissals([fence(0), fence(2000)])

  expect(await wasPushDismissed(fence(0))).toBe(true)
  expect(await wasPushDismissed(fence(1))).toBe(false)
  expect(await wasPushDismissed(fence(2000))).toBe(true)
})
