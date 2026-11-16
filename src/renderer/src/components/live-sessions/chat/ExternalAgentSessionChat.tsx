import { useCallback, useMemo, useRef } from 'react'
import { LinkActionPopover } from '@/components/link-actions/LinkActionPopover'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { structuredAgentSessionPaneKey } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import { liveSessionStatusGroup } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveMessage } from '../../../../../shared/live-sessions/live-session-types'
import { useAppStore } from '../../../store/index'
import { NATIVE_CHAT_APPEARANCE_ROOT_CLASS } from '../../native-chat/appearance/native-chat-appearance-style'
import { useNativeChatFontSize } from '../../native-chat/appearance/use-native-chat-font-size'
import { useNativeChatStoreAppearanceStyle } from '../../native-chat/appearance/use-native-chat-store-appearance-style'
import { NativeChatComposer } from '../../native-chat/composer/NativeChatComposer'
import { NativeChatPromptSlotNotices } from '../../native-chat/composer/controls/NativeChatComposerNotices'
import { useNativeChatComposerError } from '../../native-chat/composer/controls/use-native-chat-composer-notice'
import { useNativeChatRootInputRouting } from '../../native-chat/composer/focus/use-native-chat-root-input-routing'
import type { NativeChatComposerHandle } from '../../native-chat/composer/native-chat-composer-types'
import { useNativeChatTerminalTurnTiming } from '../../native-chat/conversation/turns/use-native-chat-terminal-turn-timing'
import { NativeChatEmptyState } from '../../native-chat/host-access/NativeChatEmptyState'
import { NativeChatLinkClickContext } from '../../native-chat/links/actions/native-chat-link-click-context'
import { useNativeChatFileLinkContext } from '../../native-chat/links/actions/use-native-chat-file-link-context'
import {
  NativeChatFileLinkExistenceProvider,
  useRecheckNativeChatFileLinksWhenTurnEnds
} from '../../native-chat/links/actions/use-native-chat-file-link-existence'
import { useNativeChatLinkActions } from '../../native-chat/links/actions/use-native-chat-link-actions'
import { NativeChatMarkdownImageOwnerProvider } from '../../native-chat/media/images/native-chat-markdown-image-owner'
import { useNativeChatImageRuntimeContext } from '../../native-chat/media/images/native-chat-image-runtime-context'
import { useNativeChatRevealLatest } from '../../native-chat/messages/actions/use-native-chat-reveal-latest'
import type { NativeChatExternalViewProps } from '../../native-chat/native-chat-view-types'
import {
  emptyNativeChatContextMenuActions,
  useNativeChatContextMenu
} from '../../native-chat/pane/actions/use-native-chat-context-menu'
import { useNativeChatPasteBridge } from '../../native-chat/paste/use-native-chat-paste-bridge'
import { selectNativeChatViewState } from '../../native-chat/session/status/native-chat-view-state'
import { NativeChatSubagentTranscripts } from '../../native-chat/subagents/NativeChatSubagentTranscripts'
import { closeNativeChatSubagentOnEscape } from '../../native-chat/subagents/native-chat-open-subagent'
import { NativeChatFindBar } from '../../native-chat/viewport/find/NativeChatFindBar'
import { useNativeChatFind } from '../../native-chat/viewport/find/use-native-chat-find'
import { liveSessionMenuEffects } from '../menu/live-session-menu-effects'
import {
  externalAgentSessionChatRows,
  externalAgentSessionDeliveryNotices
} from './external-agent-session-chat-rows'
import {
  externalAgentSessionComposerNotices,
  externalAgentSessionEnded
} from './external-agent-session-composer-notices'
import {
  ExternalAgentSessionPrompt,
  externalAgentSessionPromptOwnsComposer
} from './ExternalAgentSessionPrompt'
import { useExternalAgentSessionChatSource } from './use-external-agent-session-chat-source'
import { useExternalAgentSessionFocus } from './use-external-agent-session-focus'

// The registry refuses a send outright; none of the structured host's refusal causes arise here.
const NO_REFUSAL_CAUSES = {
  working: false,
  prompt: false,
  background: false,
  sending: false,
  retry: false
}

/** The chat of a session Seal does not host: the chat view's own parts over the registry. */
export function ExternalAgentSessionChat(props: NativeChatExternalViewProps): React.JSX.Element {
  return (
    <NativeChatFileLinkExistenceProvider tabId={props.tabId}>
      <NativeChatMarkdownImageOwnerProvider
        tabId={props.tabId}
        isVisible={props.isVisible}
        sessionId={props.sessionId}
      >
        <ExternalAgentSessionChatPane {...props} />
      </NativeChatMarkdownImageOwnerProvider>
    </NativeChatFileLinkExistenceProvider>
  )
}

function ExternalAgentSessionChatPane({
  tabId,
  worktreeId,
  sessionId: tabSessionId,
  isVisible,
  isFocusedGroup
}: NativeChatExternalViewProps): React.JSX.Element {
  const t = useTranslate()
  // The record id may change once while the tab stays: the pane, and its draft, go by the tab.
  const paneKey = useMemo(() => structuredAgentSessionPaneKey(tabId, tabId), [tabId])
  const openedAs = useAppStore(
    (s) => s.unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)?.agentSessionAgent
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<NativeChatComposerHandle>(null)
  // No question card here takes typed text; the paste and typing routes still ask for its field.
  const questionAnswerInputRef = useRef<HTMLTextAreaElement>(null)
  const fileLinkContext = useNativeChatFileLinkContext(tabId)
  const imageRuntimeContext = useNativeChatImageRuntimeContext(tabId)
  const { messageListRef, revealLatest, captureRevealLatest } = useNativeChatRevealLatest()
  const { composerError, reportComposerError } = useNativeChatComposerError(NO_REFUSAL_CAUSES)
  const { source, session, registryLoaded, transcript, pending } =
    useExternalAgentSessionChatSource({
      sessionId: tabSessionId,
      worktreeId,
      runtimeEnvironmentId: fileLinkContext?.runtimeEnvironmentId ?? null,
      enabled: isVisible,
      onError: reportComposerError,
      onSubmitted: revealLatest,
      captureAdmittedReveal: captureRevealLatest
    })
  const { capabilities } = source
  const agent = session?.provider ?? openedAs ?? 'claude'
  const ended = session ? externalAgentSessionEnded(session) : false
  // Waiting on its own subagents or background tasks is still the agent's turn.
  const working = session !== null && !ended && liveSessionStatusGroup(session.status) === 'working'
  const chat = useMemo(
    () =>
      externalAgentSessionChatRows({
        agent,
        providerSessionId: session?.providerSessionId ?? null,
        transcript,
        pending,
        working
      }),
    [agent, session?.providerSessionId, transcript, pending, working]
  )
  const retry = source.pending.retry
  const deliveryNotices = useMemo(
    () =>
      externalAgentSessionDeliveryNotices(pending, (message: LiveMessage) =>
        retry(message.messageId)
      ),
    [pending, retry]
  )
  const viewState = selectNativeChatViewState(chat)
  const isConversation = viewState.kind === 'ready'
  // Nothing of it can be read and the registry does not list it: said once, in the transcript's place.
  const unavailable = session === null && registryLoaded && !isConversation
  const turnTiming = useNativeChatTerminalTurnTiming(paneKey, transcript.messages, working)
  useRecheckNativeChatFileLinksWhenTurnEnds(working)

  const promptOwnsComposer = externalAgentSessionPromptOwnsComposer(source)
  const composerShown = session !== null && !promptOwnsComposer && (capabilities.send || !ended)
  const notices = useMemo(
    () =>
      externalAgentSessionComposerNotices({
        session,
        // Before the registry's first snapshot a missing record is not yet known to be gone.
        unlisted: registryLoaded && isConversation,
        failure: composerError,
        onTakeOver: liveSessionMenuEffects.takeOver,
        t
      }),
    [session, registryLoaded, isConversation, composerError, t]
  )
  const onAnswerFailed = useCallback(
    (error: unknown) =>
      reportComposerError(
        t('seal.sessionTab.answerFailed', 'Seal couldn’t answer this prompt.'),
        error instanceof Error && error.message ? { errorText: error.message } : undefined
      ),
    [reportComposerError, t]
  )

  const paneActive = isVisible && isFocusedGroup
  const rootInput = useNativeChatRootInputRouting({
    tabId,
    rootRef,
    composerRef,
    questionAnswerInputRef,
    isVisible,
    isFocusedGroup,
    composerReady: composerShown && capabilities.send,
    surfaceReady: promptOwnsComposer
  })
  useExternalAgentSessionFocus({
    sessionId: source.sessionId,
    isVisible,
    rootRef,
    composerRef
  })
  const { onLinkClick, linkActionRequest, closeLinkActions } = useNativeChatLinkActions(
    fileLinkContext,
    rootRef,
    { sessionId: source.sessionId, isVisible }
  )
  useNativeChatFontSize(isConversation && paneActive, rootRef)
  const find = useNativeChatFind(paneActive, rootRef, composerRef, messageListRef)
  const onPaste = useNativeChatPasteBridge({ rootRef, composerRef, questionAnswerInputRef })
  const contextMenu = useNativeChatContextMenu({
    rootRef,
    composerRef,
    enabled: isVisible,
    actions: { onPaste, ...emptyNativeChatContextMenuActions },
    showTerminalPaneActions: false,
    messageListRef,
    fileLinkContext,
    onFind: find.open
  })
  const appearanceStyle = useNativeChatStoreAppearanceStyle()
  const prompt = source.prompt

  const root = (
    <div
      ref={rootRef}
      data-native-chat-root="true"
      data-native-chat-working={working ? 'true' : 'false'}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        contextMenu.onPointerDownCapture(event)
        if (event.button === 2) {
          event.stopPropagation()
          return
        }
        rootInput.onPointerDownCapture(event)
      }}
      onKeyDownCapture={(event) => {
        find.onKeyDownCapture(event)
        rootInput.onKeyDownCapture(event)
      }}
      onKeyDown={(event) => closeNativeChatSubagentOnEscape(event, paneKey)}
      onContextMenuCapture={contextMenu.onContextMenuCapture}
      className={cn(
        NATIVE_CHAT_APPEARANCE_ROOT_CLASS,
        'flex h-full min-h-0 w-full flex-col focus:outline-none'
      )}
      style={appearanceStyle}
      data-native-chat-scheme={appearanceStyle.colorScheme}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        {find.isOpen ? <NativeChatFindBar find={find} isVisible={isVisible} /> : null}
        {unavailable ? (
          <NativeChatEmptyState
            kind="empty"
            headline={t('seal.sessionTab.unavailable', 'This session is no longer available')}
          />
        ) : viewState.kind === 'loading' || (session === null && !isConversation) ? (
          <NativeChatEmptyState kind="loading" />
        ) : viewState.kind === 'error' ? (
          <NativeChatEmptyState kind="error" message={viewState.message} />
        ) : viewState.kind === 'empty' ? (
          <NativeChatEmptyState kind="empty" agent={agent} />
        ) : (
          <NativeChatSubagentTranscripts
            find={find}
            paneKey={paneKey}
            ref={messageListRef}
            session={chat}
            isVisible={isVisible}
            isWorking={working}
            expandSignal={false}
            {...turnTiming}
            awaitingInput={prompt ? (capabilities.answer === 'none' ? 'unshown' : 'shown') : null}
            deliveryNotices={deliveryNotices}
            runtimeContext={imageRuntimeContext}
          />
        )}
      </div>
      {composerShown ? null : <NativeChatPromptSlotNotices notices={notices} />}
      <ExternalAgentSessionPrompt
        source={source}
        shouldFocus={paneActive}
        onAnswer={revealLatest}
        onAnswerFailed={onAnswerFailed}
      />
      {composerShown ? (
        <NativeChatComposer
          ref={composerRef}
          terminalTabId={tabId}
          paneKey={paneKey}
          targetPtyId={null}
          agent={agent}
          unavailableHint={source.composer.sendBlockedReason}
          structuredTransport={source.composer}
          notices={notices}
          recallSource={{ messages: chat.messages, withoutImageMarkers: true }}
        />
      ) : null}
      {contextMenu.menu}
      <LinkActionPopover request={linkActionRequest} onClose={closeLinkActions} />
    </div>
  )
  return <NativeChatLinkClickContext value={onLinkClick}>{root}</NativeChatLinkClickContext>
}
