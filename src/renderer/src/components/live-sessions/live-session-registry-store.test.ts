import { expect, it } from 'vitest'
import { sampleLiveSession } from './live-session.test-fixture'
import { upsertLiveSession } from './live-session-registry-store'

const ids = (sessions: { id: string }[]): string[] => sessions.map((session) => session.id)

it('holds a renamed session once, before the removal of its made-up id arrives', () => {
  const chat = { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' } as const
  const unnamedChat = sampleLiveSession('box:claude:seal-chat-1', {
    providerSessionId: 'seal-chat-1',
    surface: chat
  })
  const namedChat = sampleLiveSession('box:claude:6ddc', {
    providerSessionId: '6ddc',
    surface: chat
  })
  expect(ids(upsertLiveSession([unnamedChat], namedChat))).toEqual(['box:claude:6ddc'])

  const process = sampleLiveSession('box:claude:pid-812', {
    providerSessionId: 'pid-812',
    pid: 812
  })
  const namedProcess = sampleLiveSession('box:claude:9dcb', { providerSessionId: '9dcb', pid: 812 })
  expect(ids(upsertLiveSession([process], namedProcess))).toEqual(['box:claude:9dcb'])
})

it('keeps an ended session of the same chat beside the one that followed it', () => {
  const chat = { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' } as const
  const earlier = sampleLiveSession('box:claude:aaaa', { providerSessionId: 'aaaa', surface: chat })
  const later = sampleLiveSession('box:claude:bbbb', { providerSessionId: 'bbbb', surface: chat })
  expect(ids(upsertLiveSession([earlier], later)).sort()).toEqual([
    'box:claude:aaaa',
    'box:claude:bbbb'
  ])
})
