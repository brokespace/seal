import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import {
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Terminal,
  type LucideIcon
} from 'lucide-react-native'
import type {
  HomeChatEntry,
  HomeChatNoticeSource
} from '../../../../src/shared/home-chat/home-chat-types'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { homeChatStyles as styles } from './home-chat-styles'

type NoticeEntry = Extract<HomeChatEntry, { kind: 'notice' }>

const NOTICE_ICONS: Record<HomeChatNoticeSource, LucideIcon> = {
  job: Terminal,
  subagent: Bot,
  routine: CalendarClock,
  approval: ShieldAlert
}

/** Something that finished or fired on its own; its first line is the headline, the rest expands. */
export function HomeChatNoticeRow({ entry }: { entry: NoticeEntry }) {
  const t = useMobileTranslation()
  useMobileColorScheme()
  const [open, setOpen] = useState(false)
  const Icon = NOTICE_ICONS[entry.source]
  const [headline, ...rest] = entry.text.split('\n')
  const details = rest.join('\n').trim()
  const label = {
    job: t('seal.homeChat.notice.job', 'Background job'),
    subagent: t('seal.homeChat.notice.subagent', 'Subagent'),
    routine: t('seal.homeChat.notice.routine', 'Routine'),
    approval: t('seal.homeChat.notice.approval', 'Waiting for you')
  }[entry.source]
  const tint = entry.source === 'approval' ? colors.statusAmber : colors.textSecondary
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <View style={[styles.card, styles.noticeCard]}>
      <Pressable
        style={({ pressed }) => [styles.cardHeader, details && pressed && pressedStyle]}
        disabled={!details}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole={details ? 'button' : undefined}
        accessibilityState={details ? { expanded: open } : undefined}
      >
        <Icon size={16} color={tint} />
        <View style={styles.cardHeaderMain}>
          <Text style={styles.noticeTitle}>{label}</Text>
          <Text style={styles.meta} numberOfLines={open ? undefined : 2}>
            {headline}
          </Text>
        </View>
        {details ? <Chevron size={16} color={colors.textMuted} /> : null}
      </Pressable>
      {open ? (
        <View style={styles.cardBody}>
          <ScrollView style={styles.codeBlock} nestedScrollEnabled>
            <Text style={styles.codeText} selectable>
              {details}
            </Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}
