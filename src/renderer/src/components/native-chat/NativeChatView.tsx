import { NativeChatSessionGate } from './host-access/NativeChatSessionGate'
import { NativeChatStructuredSession } from './NativeChatStructuredSession'
import { NativeChatResolvedView } from './NativeChatResolvedView'
import { useNativeChatStatusEntry } from './session/status/use-native-chat-status-entry'
import type { NativeChatBridgeViewProps, NativeChatViewProps } from './native-chat-view-types'
import { NativeChatPaneFileDropSurface } from './attachments/intake/NativeChatPaneFileDropSurface'
import { NativeChatVisualOwnerProvider } from './media/visuals/native-chat-visual-owner'
import { NativeChatFileLinkExistenceProvider } from './links/actions/use-native-chat-file-link-existence'
import { NativeChatMarkdownImageOwnerProvider } from './media/images/native-chat-markdown-image-owner'
import { AgentSessionChatFrameSlot } from '../live-sessions/chat/AgentSessionChatFrameSlot'
import { ExternalAgentSessionChat } from '../live-sessions/chat/ExternalAgentSessionChat'

export default function NativeChatView(props: NativeChatViewProps): React.JSX.Element {
  return (
    <NativeChatPaneFileDropSurface className="relative flex h-full min-h-0 min-w-0 w-full">
      {props.mode === 'structured' ? (
        <NativeChatVisualOwnerProvider
          key={props.sessionId}
          target={props.target}
          sessionId={props.sessionId}
          tabId={props.tabId}
        >
          <NativeChatFileLinkExistenceProvider tabId={props.tabId}>
            <NativeChatMarkdownImageOwnerProvider
              tabId={props.tabId}
              isVisible={props.isVisible}
              sessionId={props.sessionId}
            >
              <AgentSessionChatFrameSlot
                lookup={{ kind: 'chat', sessionId: props.sessionId }}
                isVisible={props.isVisible}
              >
                <NativeChatStructuredSession {...props} />
              </AgentSessionChatFrameSlot>
            </NativeChatMarkdownImageOwnerProvider>
          </NativeChatFileLinkExistenceProvider>
        </NativeChatVisualOwnerProvider>
      ) : props.mode === 'external' ? (
        <AgentSessionChatFrameSlot
          lookup={{ kind: 'record', sessionId: props.sessionId }}
          isVisible={props.isVisible}
        >
          <ExternalAgentSessionChat {...props} />
        </AgentSessionChatFrameSlot>
      ) : (
        <NativeChatBridgeView {...props} />
      )}
    </NativeChatPaneFileDropSurface>
  )
}

function NativeChatBridgeView({
  terminalTabId,
  isVisible,
  isFocusedGroup,
  paneKey: preferredPaneKey,
  targetPtyId = null,
  launchAgent,
  resolvedAgent,
  ownsTabWideLaunchDraft,
  onSwitchToTerminal,
  readTerminalScreen,
  readTerminalDraft,
  contextMenuActions
}: NativeChatBridgeViewProps): React.JSX.Element {
  const { entry: agentStatusEntry, paneKey } = useNativeChatStatusEntry(
    terminalTabId,
    preferredPaneKey
  )
  return (
    <NativeChatSessionGate
      paneKey={paneKey}
      launchAgent={launchAgent}
      resolvedAgent={resolvedAgent}
      agentStatusEntry={agentStatusEntry}
      ptyId={targetPtyId}
    >
      {(resolution) => (
        <NativeChatFileLinkExistenceProvider tabId={terminalTabId}>
          <NativeChatMarkdownImageOwnerProvider
            sessionId={resolution.sessionId}
            tabId={terminalTabId}
            isVisible={isVisible}
          >
            <AgentSessionChatFrameSlot
              lookup={{ kind: 'pane', paneKey: resolution.paneKey }}
              isVisible={isVisible}
            >
              <NativeChatResolvedView
                paneKey={resolution.paneKey}
                agent={resolution.agent}
                sessionId={resolution.sessionId}
                transcriptPath={resolution.transcriptPath}
                isVisible={isVisible}
                isFocusedGroup={isFocusedGroup}
                targetPtyId={targetPtyId}
                terminalTabId={terminalTabId}
                ownsTabWideLaunchDraft={ownsTabWideLaunchDraft}
                onSwitchToTerminal={onSwitchToTerminal}
                readTerminalScreen={readTerminalScreen}
                readTerminalDraft={readTerminalDraft}
                contextMenuActions={contextMenuActions}
              />
            </AgentSessionChatFrameSlot>
          </NativeChatMarkdownImageOwnerProvider>
        </NativeChatFileLinkExistenceProvider>
      )}
    </NativeChatSessionGate>
  )
}
