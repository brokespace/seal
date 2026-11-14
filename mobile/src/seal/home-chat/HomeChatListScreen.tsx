import { useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ChevronLeft,
  CircleAlert,
  CloudOff,
  MessagesSquare,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react-native'
import type { HomeChatSummary } from '../../../../src/shared/home-chat/home-chat-types'
import { ActionSheetModal } from '../../components/ActionSheetModal'
import { ConfirmModal } from '../../components/ConfirmModal'
import { LoadingSpinner } from '../../components/LoadingSpinner'
import { MobileStateView } from '../../components/MobileStateView'
import { MobileSwitch } from '../../components/MobileSwitch'
import { NavBar } from '../../components/nav-bar/NavBar'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import { SwipeRowActions } from '../../components/SwipeRowActions'
import { TextInputModal } from '../../components/TextInputModal'
import { TransientToast, useTransientToast } from '../../components/TransientToast'
import { useNow } from '../../hooks/use-now'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { firstParam } from '../../navigation/route-param-reader'
import { useRouteHandoff } from '../../navigation/route-handoff'
import { colors, pressedStyle, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { formatTimeAgo } from '../../worktree/agent-row-display'
import { useHomeChatFeed } from './home-chat-live-feed'
import { countHomeChatWorkers, orderHomeChatRows } from './home-chat-list-order'
import { createHomeChat, deleteHomeChat, renameHomeChat } from './home-chat-operations'
import { homeChatStyles as styles } from './home-chat-styles'
import { HomeChatNewChatSheet, type HomeChatNewChatChoice } from './HomeChatNewChatSheet'

export function homeChatRoute(hostId: string, chatId: string): string {
  return `/h/${encodeURIComponent(hostId)}/seal/chat/${encodeURIComponent(chatId)}`
}

export function HomeChatListScreen() {
  const t = useMobileTranslation()
  useMobileColorScheme()
  const insets = useSafeAreaInsets()
  const router = useRouteHandoff()
  const hostId = firstParam(useLocalSearchParams<{ hostId?: string | string[] }>().hostId)
  const { client } = useHostClient(hostId)
  const { feed, snapshot } = useHomeChatFeed(client)
  const [showWorkers, setShowWorkers] = useState(true)
  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState(false)
  const [menuChat, setMenuChat] = useState<HomeChatSummary | null>(null)
  const [renaming, setRenaming] = useState<HomeChatSummary | null>(null)
  const [deleting, setDeleting] = useState<HomeChatSummary | null>(null)
  const toast = useTransientToast()
  const now = useNow()

  const create = (choice: HomeChatNewChatChoice) => {
    if (!client || creating) {
      return
    }
    setCreating(true)
    createHomeChat(client, choice)
      .then((chat) => {
        feed?.applyChat(chat)
        router.push(homeChatRoute(hostId, chat.id))
      })
      .catch(() => toast.showToast(t('seal.homeChat.createFailed', 'Could not start a chat')))
      .finally(() => setCreating(false))
  }

  const rename = (chat: HomeChatSummary, title: string) => {
    setRenaming(null)
    const trimmed = title.trim()
    if (!client || !trimmed || trimmed === chat.title) {
      return
    }
    renameHomeChat(client, chat.id, trimmed).then(
      (summary) => feed?.applySummary(summary),
      () => toast.showToast(t('seal.homeChat.renameFailed', 'Could not rename the chat'))
    )
  }

  const remove = (chat: HomeChatSummary) => {
    setDeleting(null)
    if (!client) {
      return
    }
    deleteHomeChat(client, chat.id).then(
      () => feed?.removeChat(chat.id),
      () => toast.showToast(t('seal.homeChat.deleteFailed', 'Could not delete the chat'))
    )
  }

  const chats = snapshot.chats
  const workerCount = chats ? countHomeChatWorkers(chats) : 0
  const rows = chats ? orderHomeChatRows(chats, showWorkers) : []

  const renderRow = ({ item }: { item: (typeof rows)[number] }) => {
    const { chat, indented } = item
    const subtitle =
      chat.status === 'error'
        ? t('seal.homeChat.status.error', 'Stopped with an error')
        : chat.status === 'running'
          ? t('seal.homeChat.status.running', 'Working…')
          : formatTimeAgo(chat.updatedAt, now)
    return (
      <SwipeRowActions
        trailing={{
          label: t('seal.homeChat.delete', 'Delete'),
          accessibilityLabel: t('seal.homeChat.deleteNamed', 'Delete {{title}}', {
            title: chat.title
          }),
          icon: Trash2,
          background: colors.statusRed,
          foreground: colors.onStatusRed,
          onPress: () => setDeleting(chat)
        }}
      >
        {(guardPress) => (
          <Pressable
            style={({ pressed }) => [
              styles.chatRow,
              indented && styles.workerRow,
              pressed && pressedStyle
            ]}
            onPress={guardPress(() => router.push(homeChatRoute(hostId, chat.id)))}
            onLongPress={() => setMenuChat(chat)}
            accessibilityRole="button"
            accessibilityHint={t('seal.homeChat.rowHint', 'Long press to rename or delete')}
          >
            <View style={styles.chatRowMain}>
              <Text style={styles.chatTitle} numberOfLines={1}>
                {chat.title || t('seal.homeChat.untitled', 'New chat')}
              </Text>
              <Text
                style={chat.status === 'error' ? styles.errorMeta : styles.meta}
                numberOfLines={1}
              >
                {chat.parentChatId
                  ? `${t('seal.homeChat.worker', 'Worker')} · ${subtitle}`
                  : subtitle}
              </Text>
            </View>
            {chat.status === 'running' ? (
              <LoadingSpinner size={16} color={colors.textSecondary} />
            ) : chat.status === 'error' ? (
              <CircleAlert size={16} color={colors.statusRed} />
            ) : null}
          </Pressable>
        )}
      </SwipeRowActions>
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
        title={t('seal.homeChat.title', 'Assistant')}
        subtitle={
          chats && !snapshot.live ? t('seal.homeChat.notLive', 'Not receiving updates') : undefined
        }
      />
      {chats === null ? (
        snapshot.listError ? (
          <MobileStateView
            icon={CloudOff}
            title={t('seal.homeChat.loadFailed', 'Could not load chats')}
            message={snapshot.listError}
            action={{
              label: t('seal.homeChat.retry', 'Retry'),
              onPress: () => void feed?.refreshList()
            }}
          />
        ) : (
          <MobileStateView loading title={t('seal.homeChat.loading', 'Loading chats…')} />
        )
      ) : rows.length === 0 ? (
        <MobileStateView
          icon={MessagesSquare}
          title={t('seal.homeChat.empty.title', 'Your machines, one chat')}
          message={t(
            'seal.homeChat.empty.message',
            'Ask the assistant to run commands, move files or check on jobs across your machines.'
          )}
          action={{
            label: t('seal.homeChat.new', 'New chat'),
            onPress: () => setPicking(true)
          }}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.chat.id}
          renderItem={renderRow}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 56 + spacing.xl * 2 }
          ]}
          ListHeaderComponent={
            workerCount > 0 ? (
              <View style={styles.toggleRow}>
                <Text style={styles.meta}>
                  {t('seal.homeChat.showWorkers', 'Show worker chats ({{count}})', {
                    count: workerCount
                  })}
                </Text>
                <MobileSwitch
                  value={showWorkers}
                  onValueChange={setShowWorkers}
                  accessibilityLabel={t('seal.homeChat.showWorkersLabel', 'Show worker chats')}
                />
              </View>
            ) : undefined
          }
        />
      )}
      {chats !== null && rows.length > 0 ? (
        <Pressable
          style={({ pressed }) => [
            styles.fab,
            { bottom: insets.bottom + spacing.xl },
            (pressed || creating) && pressedStyle
          ]}
          disabled={creating || !client}
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={t('seal.homeChat.new', 'New chat')}
        >
          {creating ? (
            <LoadingSpinner size={22} color={colors.onCreateActionFill} />
          ) : (
            <Plus size={24} color={colors.onCreateActionFill} />
          )}
        </Pressable>
      ) : null}
      <HomeChatNewChatSheet
        visible={picking}
        client={client}
        onPick={create}
        onClose={() => setPicking(false)}
      />
      <ActionSheetModal
        visible={menuChat !== null}
        title={menuChat?.title}
        onClose={() => setMenuChat(null)}
        actions={
          menuChat
            ? [
                {
                  label: t('seal.homeChat.rename', 'Rename'),
                  icon: Pencil,
                  closeBeforePress: true,
                  onPress: () => setRenaming(menuChat)
                },
                {
                  label: t('seal.homeChat.delete', 'Delete'),
                  icon: Trash2,
                  destructive: true,
                  closeBeforePress: true,
                  onPress: () => setDeleting(menuChat)
                }
              ]
            : []
        }
      />
      <TextInputModal
        visible={renaming !== null}
        title={t('seal.homeChat.renameTitle', 'Rename chat')}
        defaultValue={renaming?.title ?? ''}
        submitLabel={t('seal.homeChat.save', 'Save')}
        selectTextOnFocus
        onSubmit={(value) => renaming && rename(renaming, value)}
        onCancel={() => setRenaming(null)}
      />
      <ConfirmModal
        visible={deleting !== null}
        title={t('seal.homeChat.deleteTitle', 'Delete this chat?')}
        message={t(
          'seal.homeChat.deleteMessage',
          'The conversation and its attachments are removed from the desktop.'
        )}
        confirmLabel={t('seal.homeChat.delete', 'Delete')}
        destructive
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
      <TransientToast message={toast.message} bottomInset={insets.bottom} />
    </View>
  )
}
