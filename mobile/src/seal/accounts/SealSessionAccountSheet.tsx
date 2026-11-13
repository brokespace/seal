import { ActionSheetModal, type ActionSheetAction } from '../../components/ActionSheetModal'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import type { SealAccountsMutation } from './seal-accounts-operations'
import {
  sealLiveSwapLabel,
  sealProviderLabel,
  sealSessionSwapTargets
} from './seal-account-presentation'
import type {
  SealAccountsStatusRead,
  SealLiveSwapMode,
  SealSessionAssignmentRead
} from './seal-accounts-schemas'

const LIVE_SWAP_MODES: SealLiveSwapMode[] = ['inherit', 'on', 'off']

/** Moves one running session to another account, and sets whether auto-swap may move it. */
export function SealSessionAccountSheet({
  assignment,
  status,
  onMutate,
  onClose
}: {
  /** Null hides the sheet. */
  assignment: SealSessionAssignmentRead | null
  status: SealAccountsStatusRead | null
  onMutate: (busyKey: string, mutation: SealAccountsMutation) => void
  onClose: () => void
}) {
  const t = useMobileTranslation()
  const targets = assignment
    ? sealSessionSwapTargets(assignment, status?.providers[assignment.provider]?.candidates ?? [])
    : []
  const mode = assignment?.liveSwap ?? 'inherit'
  const actions: ActionSheetAction[] = assignment
    ? [
        ...targets.map((candidate) => ({
          id: `account:${candidate.key}`,
          label: candidate.label || candidate.email || candidate.key,
          hint:
            candidate.email && candidate.email !== candidate.label ? candidate.email : undefined,
          checked: candidate.key === assignment.accountKey,
          onPress: () => {
            if (candidate.key !== assignment.accountKey) {
              onMutate(`session:${assignment.id}`, {
                kind: 'swap-session',
                sessionId: assignment.id,
                account: candidate.key
              })
            }
          }
        })),
        ...LIVE_SWAP_MODES.map((option) => ({
          id: `live-swap:${option}`,
          label: sealLiveSwapLabel(option),
          checked: option === mode,
          onPress: () => {
            if (option !== mode) {
              onMutate(`session:${assignment.id}`, {
                kind: 'session-live-swap',
                sessionId: assignment.id,
                mode: option
              })
            }
          }
        }))
      ]
    : []
  return (
    <ActionSheetModal
      visible={assignment !== null}
      title={t('seal.accounts.sessionSheetTitle', 'Session account')}
      message={
        assignment
          ? t(
              'seal.accounts.sessionSheetMessage',
              '{{value0}} is on {{value1}}. Pick an account to move it to, or whether auto-swap may move it.',
              {
                value0: assignment.projectLabel ?? sealProviderLabel(assignment.provider),
                value1: assignment.accountLabel
              }
            )
          : undefined
      }
      actions={actions}
      onClose={onClose}
    />
  )
}
