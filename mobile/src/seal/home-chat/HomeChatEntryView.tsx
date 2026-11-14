import { memo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight, CircleAlert, Dot } from 'lucide-react-native'
import type { HomeChatEntry } from '../../../../src/shared/home-chat/home-chat-types'
import { MobileMarkdown } from '../../components/MobileMarkdown'
import { MOBILE_MARKDOWN_DOCUMENT_SCALE } from '../../components/mobile-markdown-styles'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { formatHomeChatDuration } from './home-chat-format'
import { homeChatStyles as styles } from './home-chat-styles'
import { HomeChatAttachmentRow } from './HomeChatAttachmentRow'
import { HomeChatNoticeRow } from './HomeChatNoticeRow'
import { HomeChatToolCard } from './HomeChatToolCard'

type ThinkingEntry = Extract<HomeChatEntry, { kind: 'thinking' }>

function Thinking({ entry }: { entry: ThinkingEntry }) {
  const t = useMobileTranslation()
  const [open, setOpen] = useState(false)
  const label = entry.streaming
    ? t('seal.homeChat.thinking.live', 'Thinking…')
    : entry.durationMs !== undefined
      ? t('seal.homeChat.thinking.done', 'Thought for {{duration}}', {
          duration: formatHomeChatDuration(entry.durationMs)
        })
      : t('seal.homeChat.thinking.brief', 'Thought briefly')
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <View>
      <Pressable
        style={styles.disclosure}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Chevron size={14} color={colors.textSecondary} />
        <Text style={styles.disclosureText}>{label}</Text>
      </Pressable>
      {open ? (
        <Text style={styles.thinkingBody} selectable>
          {entry.text}
        </Text>
      ) : null}
    </View>
  )
}

export type HomeChatEntryActions = {
  client: RpcClient | null
  chatId: string
  respond: (entryId: string, approved: boolean) => Promise<void>
  showError: (message: string) => void
}

function HomeChatEntryViewContent({
  entry,
  actions
}: {
  entry: HomeChatEntry
  actions: HomeChatEntryActions
}) {
  const t = useMobileTranslation()
  useMobileColorScheme()
  switch (entry.kind) {
    case 'user':
      return (
        <View style={styles.userColumn}>
          <View style={styles.userBubble}>
            <Text style={styles.userText} selectable>
              {entry.text}
            </Text>
          </View>
          {entry.delivery === 'failed' ? (
            <Text style={styles.deliveryFailed}>{t('seal.homeChat.notSent', 'Not sent')}</Text>
          ) : entry.delivery === 'sending' ? (
            <Text style={styles.deliveryText}>{t('seal.homeChat.sending', 'Sending…')}</Text>
          ) : null}
        </View>
      )
    case 'assistant':
      return entry.text || entry.streaming ? (
        <View>
          {entry.text ? (
            <MobileMarkdown
              content={entry.text}
              textScale={MOBILE_MARKDOWN_DOCUMENT_SCALE}
              chatMath
              rangeSelectable
              growing={entry.streaming}
              streaming={entry.streaming}
            />
          ) : null}
          {entry.streaming ? <View style={styles.streamingCursor} /> : null}
        </View>
      ) : null
    case 'thinking':
      return <Thinking entry={entry} />
    case 'tool':
      return (
        <HomeChatToolCard
          entry={entry}
          onRespond={(approved) => actions.respond(entry.id, approved)}
        />
      )
    case 'progress':
      return (
        <View style={styles.inlineRow}>
          <Dot size={18} color={colors.textSecondary} />
          <Text style={styles.progressText}>{entry.text}</Text>
        </View>
      )
    case 'compaction':
      return (
        <View style={styles.inlineRow}>
          <Dot size={18} color={colors.textSecondary} />
          <Text style={styles.progressText}>
            {entry.auto
              ? t('seal.homeChat.compaction.auto', 'Earlier messages summarized for the model')
              : t('seal.homeChat.compaction.manual', 'Earlier messages summarized at your request')}
          </Text>
        </View>
      )
    case 'error':
      return (
        <View style={styles.inlineRow}>
          <CircleAlert size={14} color={colors.statusRed} />
          <Text style={styles.errorText} selectable>
            {entry.text}
          </Text>
        </View>
      )
    case 'notice':
      return <HomeChatNoticeRow entry={entry} />
    case 'attachment':
      return (
        <HomeChatAttachmentRow
          client={actions.client}
          chatId={actions.chatId}
          entry={entry}
          onError={actions.showError}
        />
      )
  }
}

// Entries are replaced, never mutated, so an unchanged copy skips its re-render while another streams.
export const HomeChatEntryView = memo(HomeChatEntryViewContent)
