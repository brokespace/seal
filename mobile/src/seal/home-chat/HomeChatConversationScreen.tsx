import { useCallback, useMemo } from 'react'
import { FlatList, KeyboardAvoidingView, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ChevronLeft,
  CloudOff,
  MessageSquareOff,
  MessagesSquare,
  RefreshCw
} from 'lucide-react-native'
import type { HomeChatEntry } from '../../../../src/shared/home-chat/home-chat-types'
import { MobileStateView } from '../../components/MobileStateView'
import { NavBar } from '../../components/nav-bar/NavBar'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import { TransientToast, useTransientToast } from '../../components/TransientToast'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { firstParam } from '../../navigation/route-param-reader'
import { useRouteHandoff } from '../../navigation/route-handoff'
import { hostOs } from '../../platform/host-os'
import { colors, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { useHomeChatFeed } from './home-chat-live-feed'
import { respondHomeChatApproval, sendHomeChatMessage, stopHomeChat } from './home-chat-operations'
import { homeChatStyles as styles } from './home-chat-styles'
import { HomeChatComposer } from './HomeChatComposer'
import { HomeChatEntryView, type HomeChatEntryActions } from './HomeChatEntryView'
import { homeChatMessageWithAttachments, useHomeChatUploads } from './use-home-chat-uploads'

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function HomeChatConversationScreen() {
  const t = useMobileTranslation()
  useMobileColorScheme()
  const insets = useSafeAreaInsets()
  const router = useRouteHandoff()
  const params = useLocalSearchParams<{ hostId?: string | string[]; chatId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const chatId = firstParam(params.chatId)
  const { client } = useHostClient(hostId)
  const { feed, snapshot } = useHomeChatFeed(client, chatId)
  const detail = snapshot.details.get(chatId)
  const chat = detail?.chat ?? null
  const running = chat?.status === 'running'
  const toast = useTransientToast()
  const { showToast } = toast

  const uploads = useHomeChatUploads(
    client,
    chatId,
    useCallback(
      (name: string, error: unknown) =>
        showToast(
          t('seal.homeChat.uploadFailed', 'Could not attach {{name}}: {{reason}}', {
            name,
            reason: errorText(error)
          })
        ),
      [showToast, t]
    )
  )

  const respond = useCallback(
    async (entryId: string, approved: boolean) => {
      if (!client) {
        return
      }
      try {
        const handled = await respondHomeChatApproval(client, { chatId, entryId, approved })
        if (!handled) {
          showToast(t('seal.homeChat.approval.stale', 'This request was already answered'))
          void feed?.refreshChat(chatId)
        }
      } catch (error) {
        showToast(
          t('seal.homeChat.approval.failed', 'Could not send your answer: {{reason}}', {
            reason: errorText(error)
          })
        )
      }
    },
    [client, chatId, feed, showToast, t]
  )

  const actions: HomeChatEntryActions = useMemo(
    () => ({ client, chatId, respond, showError: showToast }),
    [client, chatId, respond, showToast]
  )

  const send = async (text: string): Promise<boolean> => {
    if (!client) {
      return false
    }
    try {
      await sendHomeChatMessage(
        client,
        chatId,
        homeChatMessageWithAttachments(text, uploads.uploads)
      )
      uploads.clear()
      return true
    } catch (error) {
      showToast(
        t('seal.homeChat.sendFailed', 'Could not send: {{reason}}', { reason: errorText(error) })
      )
      return false
    }
  }

  const stop = () => {
    if (client) {
      stopHomeChat(client, chatId).catch((error: unknown) =>
        showToast(
          t('seal.homeChat.stopFailed', 'Could not stop: {{reason}}', { reason: errorText(error) })
        )
      )
    }
  }

  const entries = chat?.entries
  const newestFirst = useMemo(
    () => (entries ? entries.map((_, index) => entries[entries.length - 1 - index]) : []),
    [entries]
  )
  const last = entries?.at(-1)
  const waiting =
    running && (!last || last.kind === 'user' || last.kind === 'tool' || last.kind === 'notice')

  const renderEntry = useCallback(
    ({ item }: { item: HomeChatEntry }) => <HomeChatEntryView entry={item} actions={actions} />,
    [actions]
  )

  const subtitle =
    chat?.status === 'running'
      ? t('seal.homeChat.status.running', 'Working…')
      : chat?.status === 'error'
        ? t('seal.homeChat.status.error', 'Stopped with an error')
        : chat?.backend === 'openai-compatible'
          ? t('seal.homeChat.backend.openai', 'Model API')
          : chat?.backend === 'codex'
            ? t('seal.homeChat.backend.codex', 'Codex')
            : chat
              ? t('seal.homeChat.backend.claude', 'Claude Code')
              : undefined

  let body: React.ReactNode
  if (!detail?.loaded) {
    body = detail?.error ? (
      <MobileStateView
        icon={CloudOff}
        title={t('seal.homeChat.chatLoadFailed', 'Could not load this chat')}
        message={detail.error}
        action={{
          label: t('seal.homeChat.retry', 'Retry'),
          onPress: () => void feed?.refreshChat(chatId)
        }}
      />
    ) : (
      <MobileStateView loading title={t('seal.homeChat.chatLoading', 'Loading conversation…')} />
    )
  } else if (!chat) {
    body = (
      <MobileStateView
        icon={MessageSquareOff}
        title={t('seal.homeChat.chatGone', 'This chat no longer exists')}
        action={{ label: t('seal.homeChat.back', 'Back'), onPress: () => router.back() }}
      />
    )
  } else {
    body = (
      <>
        {newestFirst.length === 0 && !waiting ? (
          <View style={styles.flex}>
            <MobileStateView
              icon={MessagesSquare}
              title={t('seal.homeChat.empty.title', 'Your machines, one chat')}
              message={t(
                'seal.homeChat.emptyChat',
                'Ask the assistant to run a command, fetch a file or check on a job.'
              )}
            />
          </View>
        ) : (
          <FlatList
            style={styles.flex}
            inverted
            data={newestFirst}
            keyExtractor={(entry) => entry.id}
            renderItem={renderEntry}
            contentContainerStyle={styles.transcriptContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            ListHeaderComponent={
              waiting ? (
                <Text style={styles.workingText}>{t('seal.homeChat.working', 'Working…')}</Text>
              ) : undefined
            }
          />
        )}
        {(snapshot.chats !== null && !snapshot.live) || detail.error ? (
          <View style={styles.banner}>
            <RefreshCw size={14} color={colors.textSecondary} />
            <Text style={[styles.meta, styles.flex]}>
              {t('seal.homeChat.reconnecting', 'Not receiving updates; reconnecting…')}
            </Text>
          </View>
        ) : null}
        <View style={[styles.composerWrap, { paddingBottom: insets.bottom + spacing.sm }]}>
          <HomeChatComposer
            running={running}
            disabled={!client}
            uploads={uploads.uploads}
            onAttach={uploads.add}
            onRemoveUpload={uploads.remove}
            onSend={send}
            onStop={stop}
            onError={showToast}
          />
        </View>
      </>
    )
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <NavBar
        leading={
          <NavBarButton
            icon={ChevronLeft}
            accessibilityLabel={t('seal.homeChat.back', 'Back')}
            onPress={() => router.back()}
          />
        }
        title={chat?.title || t('seal.homeChat.title', 'Assistant')}
        subtitle={subtitle}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={hostOs() === 'ios' ? 'padding' : undefined}
      >
        {body}
      </KeyboardAvoidingView>
      <TransientToast message={toast.message} bottomInset={insets.bottom + 120} />
    </View>
  )
}
