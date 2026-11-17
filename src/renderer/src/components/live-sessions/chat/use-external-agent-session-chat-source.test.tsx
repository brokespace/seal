// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import type {
  LiveSessionRegistryEvent,
  LiveTranscriptPage
} from '../../../../../shared/live-sessions/live-session-types'
import { sampleLiveSession } from '../live-session.test-fixture'
import { useExternalAgentSessionChatSource } from './use-external-agent-session-chat-source'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('reads nothing of a session its machine has not listed yet, then its newest page once it is', async () => {
  const sessionId = 'gpu-box:claude:abc'
  let emit: (event: LiveSessionRegistryEvent) => void = () => {}
  const newestPage: LiveTranscriptPage = {
    sessionId,
    messages: [
      {
        id: 'o900',
        role: 'assistant',
        source: 'transcript',
        timestamp: 1,
        transcriptOffset: 900,
        blocks: [{ type: 'text', text: 'Done.' }]
      }
    ],
    cursor: 1000,
    start: 900,
    more: true
  }
  vi.stubGlobal('api', {
    liveSessions: {
      onEvent: (listener: typeof emit) => {
        emit = listener
        return () => {}
      },
      onMessage: () => () => {},
      snapshot: async () => ({ revision: 1, sessions: [], hostErrors: {} }),
      messages: async () => [],
      transcriptPage: async () => newestPage,
      watchTranscript: async () => ({ watchId: 'w1', page: null }),
      unwatchTranscript: async () => {},
      onTranscriptDelta: () => () => {}
    }
  })

  const { result } = renderHook(
    () =>
      useExternalAgentSessionChatSource({
        sessionId,
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        enabled: true,
        onError: () => {}
      }),
    {
      wrapper: ({ children }) => (
        <ConfirmationDialogContext value={async () => false}>{children}</ConfirmationDialogContext>
      )
    }
  )

  await waitFor(() => expect(result.current.registryLoaded).toBe(true))
  expect(result.current.transcript.phase).toBe('loading')
  expect(result.current.transcript.messages).toEqual([])

  act(() => emit({ type: 'upsert', revision: 2, session: sampleLiveSession(sessionId) }))

  await waitFor(() => expect(result.current.transcript.phase).toBe('ready'))
  expect(result.current.transcript.messages.map((message) => message.id)).toEqual(['o900'])
  expect(result.current.transcript.hasMore).toBe(true)
})
