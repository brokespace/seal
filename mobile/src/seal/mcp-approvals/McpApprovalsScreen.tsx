import { useState } from 'react'
import { RefreshControl, ScrollView, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ShieldCheck } from 'lucide-react-native'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { useNow } from '../../hooks/use-now'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { sealStyles } from '../seal-screen-styles'
import { SealScreenFrame, useSealHostName } from '../SealScreenFrame'
import { answerMcpApproval } from './mcp-approval-operations'
import { McpApprovalCard } from './McpApprovalCard'
import { useMcpApprovalsFeed } from './mcp-approvals-feed'

type Answering = { id: string; answer: 'approve' | 'deny' }

/** MCP calls from outside assistants that wait for this person before Seal runs them. */
export function McpApprovalsScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const insets = useSafeAreaInsets()
  const hostName = useSealHostName(hostId)
  const { client, state } = useHostClient(hostId)
  const feed = useMcpApprovalsFeed(client)
  const now = useNow(1_000, feed.approvals.length > 0)
  const [answering, setAnswering] = useState<Answering | null>(null)
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null)
  const [pulling, setPulling] = useState(false)
  // The host withdraws an expired call a moment later; stop offering it now.
  const waiting = feed.approvals.filter((approval) => approval.expiresAt > now)

  const answer = async (id: string, approved: boolean) => {
    if (!client) {
      return
    }
    setAnswering({ id, answer: approved ? 'approve' : 'deny' })
    setFailure(null)
    try {
      const settled = await answerMcpApproval(client, id, approved)
      feed.remove(id)
      if (!settled) {
        setFailure({
          id,
          message: t(
            'seal.mcpApprovals.alreadySettled',
            'That call had already expired or been answered.'
          )
        })
      }
    } catch (error) {
      setFailure({ id, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setAnswering(null)
    }
  }

  const frame = (children: React.ReactNode) => (
    <SealScreenFrame hostId={hostId} title={t('seal.mcpApprovals.title', 'MCP approvals')}>
      {children}
    </SealScreenFrame>
  )

  if (state !== 'connected' && !feed.loaded) {
    return frame(<MobileOfflineState hostName={hostName} />)
  }
  if (feed.error) {
    return frame(<MobileLoadErrorState error={feed.error} onRetry={() => void feed.refresh()} />)
  }
  if (!feed.loaded) {
    return frame(<MobileStateView loading title={t('seal.mcpApprovals.loading', 'Loading')} />)
  }
  return frame(
    <ScrollView
      contentContainerStyle={[
        sealStyles.scroll,
        sealStyles.fill,
        { paddingBottom: insets.bottom + spacing.xl }
      ]}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          tintColor={colors.textSecondary}
          onRefresh={() => {
            setPulling(true)
            void feed.refresh().finally(() => setPulling(false))
          }}
        />
      }
    >
      {waiting.length === 0 ? (
        <MobileStateView
          icon={ShieldCheck}
          title={t('seal.mcpApprovals.emptyTitle', 'Nothing is waiting')}
          message={t(
            'seal.mcpApprovals.emptyMessage',
            'When an MCP client asks to run a command or do something destructive, it waits here for your answer.'
          )}
        />
      ) : (
        waiting.map((approval) => (
          <McpApprovalCard
            key={approval.id}
            approval={approval}
            now={now}
            answering={answering?.id === approval.id ? answering.answer : null}
            error={failure?.id === approval.id ? failure.message : null}
            onAnswer={(approved) => void answer(approval.id, approved)}
          />
        ))
      )}
      {failure && !waiting.some((approval) => approval.id === failure.id) ? (
        <Text style={sealStyles.errorText}>{failure.message}</Text>
      ) : null}
    </ScrollView>
  )
}
