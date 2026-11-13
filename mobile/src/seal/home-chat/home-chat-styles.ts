import { TEXT_INPUT_FONT_SIZE } from '../../platform/text-input/text-input-font-size'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'

export const homeChatStyles = themedStyleSheet(() => ({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  flex: { flex: 1 },
  listContent: { padding: spacing.lg, gap: spacing.sm },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.surface,
    backgroundColor: colors.bgPanel
  },
  workerRow: { marginLeft: spacing.xl, minHeight: 48 },
  chatRowMain: { flex: 1, minWidth: 0, gap: 2 },
  chatTitle: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: typography.metaSize },
  errorMeta: { color: colors.statusRed, fontSize: typography.metaSize },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.createActionFill
  },
  transcriptContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md
  },
  userColumn: { alignItems: 'flex-end', gap: spacing.xs },
  userBubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.surface,
    borderWidth: 1,
    borderColor: colors.chatUserBorder,
    backgroundColor: colors.chatUserSurface
  },
  userText: {
    color: colors.chatForegroundStrong,
    fontSize: typography.bodySize + 1,
    lineHeight: 22
  },
  deliveryText: { color: colors.textMuted, fontSize: typography.metaSize },
  deliveryFailed: { color: colors.statusRed, fontSize: typography.metaSize },
  streamingCursor: {
    width: 8,
    height: 16,
    marginTop: spacing.xs,
    borderRadius: radii.mark,
    backgroundColor: colors.textSecondary
  },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 32 },
  disclosureText: { color: colors.textSecondary, fontSize: typography.metaSize + 1 },
  thinkingBody: {
    color: colors.textSecondary,
    fontSize: typography.metaSize + 1,
    lineHeight: 19,
    paddingLeft: spacing.lg + 2
  },
  inlineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  progressText: { flex: 1, color: colors.textSecondary, fontSize: typography.metaSize + 1 },
  errorText: {
    flex: 1,
    color: colors.statusRed,
    fontSize: typography.metaSize + 1,
    lineHeight: 19
  },
  card: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.surface,
    overflow: 'hidden'
  },
  noticeCard: { backgroundColor: colors.bgPanel },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  cardHeaderMain: { flex: 1, minWidth: 0, gap: 2 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: typography.metaSize + 1,
    fontWeight: '600',
    textTransform: 'capitalize'
  },
  noticeTitle: { color: colors.textPrimary, fontSize: typography.metaSize + 1, fontWeight: '600' },
  cardSummary: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    fontVariant: ['tabular-nums']
  },
  machineChip: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill
  },
  statusChipText: { fontSize: typography.metaSize - 1, fontWeight: '600' },
  cardBody: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm
  },
  codeBlock: {
    maxHeight: 320,
    borderRadius: radii.mark,
    backgroundColor: colors.editorSurface,
    padding: spacing.sm
  },
  codeText: {
    color: colors.textPrimary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    lineHeight: 17
  },
  codeTextMuted: { color: colors.textSecondary },
  approvalBar: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    padding: spacing.md,
    gap: spacing.md
  },
  approvalReason: { color: colors.textPrimary, fontSize: typography.bodySize, lineHeight: 20 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  button: {
    minHeight: 40,
    minWidth: 96,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bgRaised
  },
  ghostButton: { backgroundColor: 'transparent' },
  primaryButton: { backgroundColor: colors.surfaceBright },
  buttonText: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  primaryButtonText: { color: colors.bgBase },
  disabled: { opacity: 0.4 },
  attachmentImage: { width: '100%', height: 220, backgroundColor: colors.bgPanel },
  attachmentActions: { flexDirection: 'row', gap: spacing.xs },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill
  },
  workingText: { color: colors.textSecondary, fontSize: typography.metaSize + 1 },
  banner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.surface,
    backgroundColor: colors.bgPanel
  },
  composerWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  composer: {
    borderWidth: 1,
    borderColor: colors.composerBorder,
    borderRadius: radii.floating,
    backgroundColor: colors.composerSurface,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs
  },
  composerInput: {
    color: colors.textPrimary,
    fontSize: TEXT_INPUT_FONT_SIZE,
    maxHeight: 160,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  composerBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  composerButton: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.composerControl
  },
  sendButton: { backgroundColor: colors.surfaceBright },
  pendingFiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pendingFile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '100%',
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill
  },
  pendingFileText: { flexShrink: 1, color: colors.textPrimary, fontSize: typography.metaSize }
}))
