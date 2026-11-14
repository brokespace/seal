import { useMemo, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import type {
  SealAccountGroup,
  SealFleetAccount,
  SealFleetMachine
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { Button } from '../../ui/button'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { SealAccountCard, type SealAccountCardActions } from './SealAccountCard'
import { sealGroupDescription, sealGroupTitle } from './seal-account-presentation'

const pointerOptions = { activationConstraint: { distance: 4 } }
const keyboardOptions = { coordinateGetter: sortableKeyboardCoordinates }

type SealAccountGroupSectionProps = {
  group: SealAccountGroup
  accounts: readonly SealFleetAccount[]
  status: SealAccountsStatus
  now: number
  pushTargets: readonly SealFleetMachine[]
  onAdd: () => void
  /** The group's accounts in their new order of preference. */
  onReorder: (accounts: SealFleetAccount[]) => void
  actionsFor: (account: SealFleetAccount) => SealAccountCardActions
  /** Provider-wide option rows shown under the accounts. */
  footer?: ReactNode
}

type RowProps = Omit<
  SealAccountGroupSectionProps,
  'group' | 'accounts' | 'onAdd' | 'onReorder' | 'footer'
> & {
  account: SealFleetAccount
  rank: number
  sortable: boolean
}

function SortableAccount({
  account,
  rank,
  sortable,
  status,
  now,
  pushTargets,
  actionsFor
}: RowProps) {
  const t = useTranslate()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: account.key, disabled: !sortable })
  return (
    <SealAccountCard
      account={account}
      rank={rank}
      settings={status.config.autoSwap[account.provider]}
      quarantine={status.quarantine[account.key]}
      now={now}
      pushTargets={pushTargets}
      rowRef={setNodeRef}
      rowStyle={{
        transform: CSS.Translate.toString(transform),
        transition,
        ...(isDragging ? { position: 'relative', zIndex: 1, opacity: 0.85 } : {})
      }}
      grip={
        sortable ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
            aria-label={t('seal.accounts.action.reorder', 'Change the priority of {{value0}}', {
              value0: account.candidate.label
            })}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )
      }
      {...actionsFor(account)}
    />
  )
}

/** One provider's accounts in order of preference; dragging a card changes its priority. */
export function SealAccountGroupSection({
  group,
  accounts,
  status,
  now,
  pushTargets,
  onAdd,
  onReorder,
  actionsFor,
  footer
}: SealAccountGroupSectionProps): React.JSX.Element {
  const t = useTranslate()
  const sensors = useSensors(
    useSensor(PointerSensor, pointerOptions),
    useSensor(KeyboardSensor, keyboardOptions)
  )
  const reorderHint = t(
    'seal.accounts.reorderHint',
    'Drag to change priority, or focus the handle and use Space and the arrow keys.'
  )
  const accessibility = useMemo(
    () => ({ screenReaderInstructions: { draggable: reorderHint } }),
    [reorderHint]
  )
  const ids = accounts.map((account) => account.key)
  const addLabel =
    group === 'apiKeys'
      ? t('seal.accounts.add.apiKey', 'Add API key')
      : t('seal.accounts.add.account', 'Add account')
  return (
    <SettingsGroup
      id={`seal-accounts-${group}`}
      title={sealGroupTitle(group, t)}
      description={sealGroupDescription(group, t)}
      action={
        <Button variant="outline" size="xs" onClick={onAdd} data-slot={`seal-add-${group}`}>
          <Plus />
          {addLabel}
        </Button>
      }
    >
      {accounts.length === 0 ? (
        <div
          className="flex flex-col items-start gap-2 py-4"
          data-settings-row=""
          data-slot="seal-group-empty"
        >
          <p className="text-xs text-muted-foreground">
            {group === 'claude'
              ? t(
                  'seal.accounts.empty.claude',
                  'No Claude accounts yet. Sign in with your browser, use the login already on this computer, or paste a setup token.'
                )
              : group === 'codex'
                ? t(
                    'seal.accounts.empty.codex',
                    'No Codex accounts yet. Sign in with your browser or a device code, or use the login already on this computer.'
                  )
                : t(
                    'seal.accounts.empty.apiKeys',
                    'No API keys. Add one if you want sessions to fall back to pay-as-you-go when every subscription is used up.'
                  )}
          </p>
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus />
            {addLabel}
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          accessibility={accessibility}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            const from = ids.indexOf(String(active.id))
            const to = over ? ids.indexOf(String(over.id)) : -1
            if (from !== -1 && to !== -1 && from !== to) {
              onReorder(arrayMove([...accounts], from, to))
            }
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {accounts.map((account, index) => (
              <SortableAccount
                key={account.key}
                account={account}
                rank={index + 1}
                sortable={accounts.length > 1}
                status={status}
                now={now}
                pushTargets={pushTargets}
                actionsFor={actionsFor}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      {footer}
    </SettingsGroup>
  )
}
