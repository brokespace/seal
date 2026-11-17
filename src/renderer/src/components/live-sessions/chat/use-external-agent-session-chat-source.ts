import { useMemo, useState, useSyncExternalStore } from 'react'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import type { AgentSessionChatSource } from '../../../../../shared/live-sessions/agent-session-chat-source'
import { liveSessionExecutionHost } from '../../../../../shared/live-sessions/live-session-execution-host'
import type {
  AgentSessionCapabilityFlags,
  LiveSession
} from '../../../../../shared/live-sessions/live-session-types'
import { nativeChatLocalAttachmentUnsupportedNotice } from '../../native-chat/attachments/intake/native-chat-attachment-notices'
import type {
  NativeChatComposerSessionPlace,
  NativeChatStructuredComposerTransport
} from '../../native-chat/composer/submit/native-chat-structured-composer-transport'
import { useTranscriptContextUsage } from '../../native-chat/usage/use-native-chat-context-usage-summary'
import { pendingRows, type PendingRow } from '../live-session-pending-rows'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { retryLiveMessage } from '../live-session-retry'
import { sendLiveMessage } from '../live-session-send'
import { agentSessionWorktreeId } from '../open/agent-session-workspace'
import { useLiveTranscriptFeed, type LiveTranscript } from '../use-live-transcript'
import { externalAgentSessionSendHold } from './external-agent-session-composer-notices'
import { externalAgentSessionComposerTransport } from './external-agent-session-composer-transport'
import { liveTranscriptFeed } from './live-transcript-feed'
import { useAgentSessionRecord } from './use-agent-session-record'

export type ExternalAgentSessionChatSource =
  AgentSessionChatSource<NativeChatStructuredComposerTransport>

/** A record the registry no longer lists: its transcript may still read, nothing can be written. */
const UNLISTED: AgentSessionCapabilityFlags = {
  send: false,
  answer: 'none',
  transcript: true,
  recap: false,
  context: 'none',
  switchSurface: { toChat: false, toCli: false },
  takeOver: false
}

const { subscribe } = liveSessionRegistryStore

/** The same object while its contents are the same: the registry replaces a record whole on every change. */
function useSameWhileEqual<T>(value: T): T {
  const key = JSON.stringify(value) ?? ''
  const [held, setHeld] = useState({ key, value })
  if (held.key !== key) {
    setHeld({ key, value })
    return value
  }
  return held.value
}

/** The same object while the record places the session the same. */
function useSessionPlace(session: LiveSession | null): NativeChatComposerSessionPlace | null {
  // Read on every render: the link follows the registry's record as well as this window's catalog.
  const worktreeId = useAppStore(() => (session ? agentSessionWorktreeId(session) : null))
  const executionHostId = session ? liveSessionExecutionHost(session.machine) : null
  const machine = session?.machine.label ?? ''
  const cwd = session?.cwd ?? null
  const project = session?.project ?? null
  return useMemo(
    () => (executionHostId ? { executionHostId, machine, cwd, project, worktreeId } : null),
    [executionHostId, machine, cwd, project, worktreeId]
  )
}

export type ExternalAgentSessionChatSourceArgs = {
  /** The record id the tab holds; it may be the id the session went by before its first prompt. */
  sessionId: string
  worktreeId: string
  runtimeEnvironmentId: string | null
  /** False while the tab is behind another: the transcript is not watched. */
  enabled: boolean
} & Pick<NativeChatStructuredComposerTransport, 'onError' | 'onSubmitted' | 'captureAdmittedReveal'>

/**
 * The chat source of a session Seal does not host, over the registry: its transcript, its outbox,
 * its permission prompt and the composer's transport. With it come the record and the transcript
 * as the view holds them.
 */
export function useExternalAgentSessionChatSource(args: ExternalAgentSessionChatSourceArgs): {
  source: ExternalAgentSessionChatSource
  /** Null while the registry lists no such record. */
  session: LiveSession | null
  /** False until the registry's first snapshot: a missing record is not yet known to be gone. */
  registryLoaded: boolean
  transcript: LiveTranscript
  pending: readonly PendingRow[]
} {
  const t = useTranslate()
  const confirm = useConfirmationDialog()
  const { worktreeId, runtimeEnvironmentId, onError, onSubmitted, captureAdmittedReveal } = args
  const sessionId = useSyncExternalStore(subscribe, () =>
    liveSessionRegistryStore.currentId(args.sessionId)
  )
  const session = useAgentSessionRecord({ kind: 'record', sessionId })
  const registryLoaded = useSyncExternalStore(
    subscribe,
    () => liveSessionRegistryStore.getState().loaded
  )
  const outbox = useSyncExternalStore(subscribe, () => liveSessionRegistryStore.getState().messages)
  const feed = useMemo(() => liveTranscriptFeed(sessionId), [sessionId])
  // Nothing reads an unlisted session: its first page waits for its machine to list it.
  const transcript = useLiveTranscriptFeed(feed, args.enabled && session !== null, session)
  const sent = useMemo(
    () =>
      [...outbox.values()].filter(
        (message) => liveSessionRegistryStore.currentId(message.sessionId) === sessionId
      ),
    [outbox, sessionId]
  )
  const pending = useMemo(
    () => pendingRows(transcript.messages, transcript.readTo, sent),
    [transcript.messages, transcript.readTo, sent]
  )
  const capabilities = useSameWhileEqual(session?.capabilities ?? UNLISTED)
  const recorded = useSameWhileEqual(session?.context)
  const context = useTranscriptContextUsage(
    capabilities.context === 'none'
      ? undefined
      : { agent: session?.provider, messages: transcript.messages, recorded }
  )
  const sendHold = session ? externalAgentSessionSendHold(session, t) : null
  const sessionPlace = useSessionPlace(session)
  const composer = useMemo(
    () =>
      externalAgentSessionComposerTransport({
        sessionId,
        capabilities,
        worktreeId,
        runtimeEnvironmentId,
        sessionPlace,
        attachmentsUnavailableNotice: nativeChatLocalAttachmentUnsupportedNotice(),
        sendUnavailableReason: sendHold ?? '',
        context,
        send: (text) => sendLiveMessage(sessionId, text),
        onError,
        onSubmitted,
        captureAdmittedReveal
      }),
    [
      sessionId,
      capabilities,
      worktreeId,
      runtimeEnvironmentId,
      sessionPlace,
      sendHold,
      context,
      onError,
      onSubmitted,
      captureAdmittedReveal
    ]
  )
  const prompt = useSameWhileEqual(session?.permission ?? null)
  const source = useMemo<ExternalAgentSessionChatSource>(
    () => ({
      sessionId,
      messages: feed,
      pending: {
        list: () => sent,
        retry: (messageId) => {
          const message = sent.find((candidate) => candidate.messageId === messageId)
          if (message) {
            void retryLiveMessage(message, confirm)
          }
        }
      },
      prompt,
      answer: async (promptId, answer) => {
        if (answer.kind !== 'option') {
          throw new Error('A session outside Seal takes one of its prompt’s options.')
        }
        const result = await window.api.liveSessions.answer({
          sessionId,
          promptId,
          optionId: answer.optionId
        })
        // A prompt that is no longer up was answered where the session runs: nothing failed.
        if (!result.ok && result.reason !== 'prompt_not_pending') {
          throw new Error(result.error ?? result.reason)
        }
      },
      composer,
      capabilities
    }),
    [sessionId, feed, sent, confirm, prompt, composer, capabilities]
  )
  return { source, session, registryLoaded, transcript, pending }
}
