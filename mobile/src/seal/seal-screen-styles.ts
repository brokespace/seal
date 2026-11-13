import { LIST_ROW_PADDING } from '../components/list/ListGroup'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
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
  mutedText: { fontSize: typography.metaSize, color: colors.textSecondary },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.surface,
    backgroundColor: colors.sheetGroup,
    paddingHorizontal: LIST_ROW_PADDING,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm
  },
  bannerText: { flex: 1, fontSize: typography.bodySize, color: colors.textPrimary },
  textButton: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  textButtonLabel: { fontSize: typography.bodySize, fontWeight: '500', color: colors.accentBlue }
}))
