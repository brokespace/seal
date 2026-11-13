import { StyleSheet } from 'react-native'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'

export const machineScreenStyles = themedStyleSheet(() => ({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  header: {
    backgroundColor: colors.bgBase
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md
  },
  card: {
    borderRadius: radii.surface,
    backgroundColor: colors.bgPanel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    gap: spacing.md
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600'
  },
  cardMeta: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  cardDetail: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  mono: {
    fontFamily: typography.monoFamily
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill
  },
  kindBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill
  },
  kindBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600'
  },
  vitals: {
    gap: spacing.sm
  },
  vitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  vitalLabel: {
    width: 56,
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  vitalTrack: {
    flex: 1,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill,
    overflow: 'hidden'
  },
  vitalFill: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.textSecondary
  },
  vitalFillWarning: {
    backgroundColor: colors.statusAmber
  },
  vitalFillCritical: {
    backgroundColor: colors.statusRed
  },
  vitalValue: {
    minWidth: 92,
    textAlign: 'right',
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums']
  },
  detailHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.md
  },
  crumbs: {
    flexGrow: 0
  },
  crumbsContent: {
    alignItems: 'center',
    gap: 2,
    paddingRight: spacing.lg
  },
  crumb: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.mark
  },
  crumbText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  },
  crumbCurrent: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  rowText: {
    flex: 1,
    minWidth: 0
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  rowMeta: {
    marginTop: 1,
    color: colors.textMuted,
    fontSize: 11
  },
  footerStatus: {
    paddingVertical: spacing.lg,
    alignItems: 'center'
  },
  footerText: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  inlineError: {
    color: colors.statusRed,
    fontSize: typography.metaSize
  },
  transfers: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm
  },
  transferRow: {
    gap: spacing.xs
  },
  transferTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  transferTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '500'
  },
  transferMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums']
  },
  transferAction: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.control
  },
  transferActionText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  sheetFields: {
    gap: spacing.sm,
    paddingTop: spacing.sm
  },
  sheetTitle: {
    paddingHorizontal: spacing.xs,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600'
  },
  sheetMessage: {
    paddingHorizontal: spacing.xs,
    color: colors.textMuted,
    fontSize: 13
  },
  sheetError: {
    paddingHorizontal: spacing.xs,
    color: colors.statusRed,
    fontSize: typography.metaSize
  },
  sheetCancel: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.control
  },
  previewImageScroll: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  previewImageContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  previewImage: {
    width: '100%',
    height: '100%'
  }
}))
