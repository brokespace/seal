import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Server,
  ShieldAlert,
  Wrench,
  X
} from 'lucide-react-native'
import { LoadingSpinner } from '../../components/LoadingSpinner'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { formatHomeChatDuration } from './home-chat-format'
import { homeChatStyles as styles } from './home-chat-styles'
import {
  HOME_CHAT_TOOL_ICONS,
  homeChatToolLabel,
  homeChatToolSummary,
  type HomeChatToolEntry
} from './home-chat-tool-summary'

function StatusChip({ status }: { status: HomeChatToolEntry['status'] }) {
  const t = useMobileTranslation()
  const { label, color, icon } = {
    'awaiting-approval': {
      label: t('seal.homeChat.tool.awaitingApproval', 'Needs approval'),
      color: colors.statusAmber,
      icon: <ShieldAlert size={12} color={colors.statusAmber} />
    },
    running: {
      label: t('seal.homeChat.tool.running', 'Running'),
      color: colors.textSecondary,
      icon: <LoadingSpinner size={12} color={colors.textSecondary} />
    },
    ok: {
      label: t('seal.homeChat.tool.ok', 'Done'),
      color: colors.statusGreen,
      icon: <Check size={12} color={colors.statusGreen} />
    },
    error: {
      label: t('seal.homeChat.tool.error', 'Failed'),
      color: colors.statusRed,
      icon: <X size={12} color={colors.statusRed} />
    },
    denied: {
      label: t('seal.homeChat.tool.denied', 'Denied'),
      color: colors.textSecondary,
      icon: <Ban size={12} color={colors.textSecondary} />
    }
  }[status]
  return (
    <View style={styles.statusChip}>
      {icon}
      <Text style={[styles.statusChipText, { color }]}>{label}</Text>
    </View>
  )
}

/** A tool call: what it does, where, how it went; awaiting calls carry the approval decision. */
export function HomeChatToolCard({
  entry,
  onRespond
}: {
  entry: HomeChatToolEntry
  onRespond: (approved: boolean) => Promise<void>
}) {
  const t = useMobileTranslation()
  useMobileColorScheme()
  const [open, setOpen] = useState(false)
  const [responding, setResponding] = useState(false)
  const Icon = HOME_CHAT_TOOL_ICONS[entry.tool] ?? Wrench
  const summary = homeChatToolSummary(entry)
  const writtenContent =
    entry.tool === 'write_file' && typeof entry.input.content === 'string'
      ? entry.input.content
      : ''
  const expandable = Boolean(entry.output) || Boolean(writtenContent)
  const Chevron = open ? ChevronDown : ChevronRight

  const respond = (approved: boolean) => {
    if (responding) {
      return
    }
    setResponding(true)
    void onRespond(approved).finally(() => setResponding(false))
  }

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHeader, expandable && pressed && pressedStyle]}
        disabled={!expandable}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole={expandable ? 'button' : undefined}
        accessibilityState={expandable ? { expanded: open } : undefined}
      >
        <Icon size={16} color={colors.textSecondary} />
        <View style={styles.cardHeaderMain}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {homeChatToolLabel(entry.tool)}
            </Text>
            <StatusChip status={entry.status} />
          </View>
          {summary ? (
            <Text style={styles.cardSummary} numberOfLines={2}>
              {summary}
            </Text>
          ) : null}
          {entry.machine || entry.durationMs !== undefined ? (
            <View style={styles.cardTitleRow}>
              {entry.machine ? (
                <View style={styles.machineChip}>
                  <Server size={11} color={colors.textMuted} />
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {entry.machine}
                  </Text>
                </View>
              ) : null}
              {entry.durationMs !== undefined ? (
                <Text style={styles.cardMeta}>{formatHomeChatDuration(entry.durationMs)}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {expandable ? <Chevron size={16} color={colors.textMuted} /> : null}
      </Pressable>

      {open ? (
        <View style={styles.cardBody}>
          {writtenContent ? (
            <ScrollView style={styles.codeBlock} nestedScrollEnabled>
              <Text style={[styles.codeText, styles.codeTextMuted]} selectable>
                {writtenContent}
              </Text>
            </ScrollView>
          ) : null}
          {entry.output ? (
            <ScrollView style={styles.codeBlock} nestedScrollEnabled>
              <Text style={styles.codeText} selectable>
                {entry.output}
              </Text>
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {entry.status === 'awaiting-approval' ? (
        <View style={styles.approvalBar}>
          <Text style={styles.approvalReason}>
            {entry.approvalReason ??
              t('seal.homeChat.approval.default', 'This action needs your approval.')}
          </Text>
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.ghostButton,
                responding && styles.disabled,
                pressed && pressedStyle
              ]}
              disabled={responding}
              onPress={() => respond(false)}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>{t('seal.homeChat.approval.deny', 'Deny')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                responding && styles.disabled,
                pressed && pressedStyle
              ]}
              disabled={responding}
              onPress={() => respond(true)}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, styles.primaryButtonText]}>
                {t('seal.homeChat.approval.approve', 'Approve')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  )
}
