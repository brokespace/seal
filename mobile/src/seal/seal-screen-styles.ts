import { LIST_ROW_PADDING } from '../components/list/ListGroup'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'

export const sealStyles = themedStyleSheet(() => ({
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  fill: { flexGrow: 1 },
  group: { marginBottom: spacing.sm },
  groupLabel: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    paddingHorizontal: LIST_ROW_PADDING,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs
  },
  hint: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    paddingHorizontal: LIST_ROW_PADDING,
    paddingVertical: spacing.sm
  },
  errorText: { fontSize: typography.metaSize, color: colors.statusRed },
  textButton: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  textButtonLabel: { fontSize: typography.bodySize, fontWeight: '500', color: colors.accentBlue }
}))
