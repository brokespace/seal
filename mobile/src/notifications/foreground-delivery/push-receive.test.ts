import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value)
    }
  }
}))
vi.mock('expo-notifications', () => ({
  getPresentedNotificationsAsync: vi.fn(async () => []),
  dismissNotificationAsync: vi.fn()
}))
vi.mock('../../host-catalog/host-store', () => ({
  loadHostCatalog: async () => [
    { id: 'host-paired', publicKeyB64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=' }
  ]
}))
vi.mock('../delivery-policy/notification-viewing-policy', () => ({
  shouldSuppressNotificationWhileViewing: () => false
}))

import { wasPushDismissed } from '../dismissal/push-dismissal-watermarks'
import { foregroundNotificationBehavior } from './push-receive'

function fence(hostFingerprint: string) {
  return {
    hostFingerprint,
    notificationId: 'note',
    notificationEpoch: 'epoch-a',
    notificationSeq: 4
  }
}

function dismissPush(hostFingerprint: string) {
  return { request: { content: { data: { kind: 'dismiss', ...fence(hostFingerprint) } } } }
}

beforeEach(() => {
  storage.clear()
  vi.clearAllMocks()
})

describe('foreground dismiss pushes', () => {
  it('ignores one from a host this phone is not paired with', async () => {
    const behavior = await foregroundNotificationBehavior(dismissPush('Yw3NKWbEM2aRElRI'))

    expect(behavior.shouldShowBanner).toBe(false)
    expect(await wasPushDismissed(fence('Yw3NKWbEM2aRElRI'))).toBe(false)
    expect(Notifications.getPresentedNotificationsAsync).not.toHaveBeenCalled()
  })

  it('records one from a paired host', async () => {
    const behavior = await foregroundNotificationBehavior(dismissPush('riFsLvUkejeCwTXv'))

    expect(behavior.shouldShowBanner).toBe(false)
    expect(await wasPushDismissed(fence('riFsLvUkejeCwTXv'))).toBe(true)
  })
})
