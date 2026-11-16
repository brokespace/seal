import { describe, expect, it } from 'vitest'
import type { NotificationSettings } from '../notification-settings-types'
import { migrateLiveSessionsNotify } from './live-session-settings'

const notifications: NotificationSettings = {
  enabled: true,
  agentTaskComplete: true,
  agentNeedsInput: true,
  terminalBell: true,
  suppressWhenFocused: false,
  customSoundId: 'bong',
  customSoundPath: null,
  customSoundVolume: 40,
  mutedNotificationSourceIds: [],
  notifyHiddenWorkspaces: true
}

describe('the legacy session notification switch', () => {
  it('keeps a profile that had it off silent, through the two agent notification settings', () => {
    expect(migrateLiveSessionsNotify({ liveSessionsNotify: false, notifications })).toStrictEqual({
      liveSessionsNotify: undefined,
      notifications: {
        enabled: true,
        agentTaskComplete: false,
        agentNeedsInput: false,
        terminalBell: true,
        suppressWhenFocused: false,
        customSoundId: 'bong',
        customSoundPath: null,
        customSoundVolume: 40,
        mutedNotificationSourceIds: [],
        notifyHiddenWorkspaces: true
      }
    })
  })

  it('is only cleared when it was on', () => {
    expect(migrateLiveSessionsNotify({ liveSessionsNotify: true, notifications })).toStrictEqual({
      liveSessionsNotify: undefined
    })
  })

  it('leaves a profile that never set it alone', () => {
    expect(migrateLiveSessionsNotify({ notifications })).toBeNull()
  })
})
