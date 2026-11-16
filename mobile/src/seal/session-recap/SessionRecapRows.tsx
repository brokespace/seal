import { Pressable, Text, View } from 'react-native'
import {
  Check,
  CircleAlert,
  CircleDot,
  ExternalLink,
  FileText,
  GitPullRequest,
  Link2,
  Undo2,
  X
} from 'lucide-react-native'
import { ViewedCheckbox } from '../../components/MobileDiffReviewFileSummary'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type {
  RecapItem,
  RecapItemMark,
  RecapReference,
  RecapWorkState
} from '../../../../src/shared/session-recap/session-recap-types'

/** An item's words. */
function RecapText({
  text,
  muted = false,
  struck = false,
  strong = false,
  mono = false
}: {
  text: string
  muted?: boolean
  struck?: boolean
  strong?: boolean
  mono?: boolean
}) {
  return (
    <View style={styles.main}>
      <Text
        style={[
          styles.text,
          muted && styles.textMuted,
          struck && styles.textStruck,
          strong && styles.textStrong,
          mono && styles.textMono
        ]}
      >
        {text}
      </Text>
    </View>
  )
}

/** A plain line of the recap: something asked, decided or left unaddressed. */
export function RecapLineRow({
  item,
  kind
}: {
  item: RecapItem
  /** Set where items of several kinds share a list. */
  kind?: string
}) {
  useMobileColorScheme()
  return (
    <View style={styles.row}>
      {kind ? <Text style={styles.kind}>{kind}</Text> : null}
      <RecapText text={item.text} />
    </View>
  )
}

const WORK_ICONS: Record<RecapWorkState, typeof Check> = {
  done: Check,
  'in-progress': CircleDot,
  blocked: CircleAlert
}

/** Something the agent did, is doing, or is stuck on. */
export function RecapWorkRow({ item, label }: { item: RecapItem; label: string }) {
  useMobileColorScheme()
  const state = item.state ?? 'done'
  const Icon = WORK_ICONS[state]
  const color =
    state === 'in-progress'
      ? colors.accentBlue
      : state === 'blocked'
        ? colors.statusAmber
        : colors.textMuted
  return (
    <View style={styles.row} testID={`recap-work-${state}`}>
      <View style={styles.icon} accessible accessibilityLabel={label}>
        <Icon size={15} color={color} strokeWidth={2.2} />
      </View>
      <RecapText text={item.text} muted={state === 'done'} strong={state !== 'done'} />
    </View>
  )
}

/** A question or an action item for the user: tick it when handled, dismiss it when it does not matter. */
export function RecapTickRow({
  item,
  mark,
  isNew = false,
  onMark
}: {
  item: RecapItem
  mark: RecapItemMark | undefined
  /** It came up since the user last looked. */
  isNew?: boolean
  onMark: (itemId: string, mark: RecapItemMark | null) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  return (
    <View style={styles.row} testID={`recap-item-${item.id}`}>
      <View style={styles.icon}>
        <ViewedCheckbox
          viewed={mark === 'done'}
          onPress={() => onMark(item.id, mark === 'done' ? null : 'done')}
          accessibilityLabel={t('seal.sessionRecap.tick', 'Done: {{item}}', { item: item.text })}
        />
      </View>
      <RecapText text={item.text} muted={mark !== undefined} struck={mark !== undefined} />
      {isNew && mark === undefined ? (
        <Text style={styles.kind} testID="recap-new">
          {t('seal.sessionRecap.new', 'New')}
        </Text>
      ) : null}
      {mark === 'done' ? null : (
        <Pressable
          onPress={() => onMark(item.id, mark === 'dismissed' ? null : 'dismissed')}
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel={
            mark === 'dismissed'
              ? t('seal.sessionRecap.restore', 'Bring back: {{item}}', { item: item.text })
              : t('seal.sessionRecap.dismiss', 'Dismiss: {{item}}', { item: item.text })
          }
          testID={`recap-${mark === 'dismissed' ? 'restore' : 'dismiss'}-${item.id}`}
          style={({ pressed }) => [styles.action, pressed && pressedStyle]}
        >
          {mark === 'dismissed' ? (
            <Undo2 size={15} color={colors.textMuted} strokeWidth={2.2} />
          ) : (
            <X size={15} color={colors.textMuted} strokeWidth={2.2} />
          )}
        </Pressable>
      )}
    </View>
  )
}

const REFERENCE_ICONS = { file: FileText, pr: GitPullRequest, link: Link2 } as const

/** A file the agent changed, or a pull request or link that came up. */
export function RecapReferenceRow({
  reference,
  onOpenLink
}: {
  reference: RecapReference
  onOpenLink: (url: string) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const Icon = REFERENCE_ICONS[reference.kind]
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Icon size={15} color={colors.textMuted} strokeWidth={2} />
      </View>
      <RecapText text={reference.label} mono={reference.kind === 'file'} />
      {reference.kind === 'file' ? null : (
        <Pressable
          onPress={() => onOpenLink(reference.target)}
          hitSlop={spacing.sm}
          accessibilityRole="link"
          testID={`recap-open-${reference.target}`}
          accessibilityLabel={t('seal.sessionRecap.openLink', 'Open {{label}} in the browser', {
            label: reference.label
          })}
          style={({ pressed }) => [styles.action, pressed && pressedStyle]}
        >
          <ExternalLink size={15} color={colors.textMuted} strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  icon: { width: 20, minHeight: 20, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 },
  text: { fontSize: typography.bodySize, lineHeight: 20, color: colors.textPrimary },
  textMuted: { color: colors.textSecondary },
  textStruck: { textDecorationLine: 'line-through' },
  textStrong: { fontWeight: '500' },
  textMono: { fontFamily: typography.monoFamily, fontSize: 13 },
  kind: {
    marginTop: 1,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    fontSize: 11,
    color: colors.textSecondary
  },
  action: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }
}))
