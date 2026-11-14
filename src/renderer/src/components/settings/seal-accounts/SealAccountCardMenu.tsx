import { LogIn, MoreHorizontal, Pencil, Send, Trash2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type {
  SealFleetAccount,
  SealFleetMachine
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { Button } from '../../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../../ui/dropdown-menu'

type SealAccountCardMenuProps = {
  account: SealFleetAccount
  pushTargets: readonly SealFleetMachine[]
  onRelogin: () => void
  onEdit: () => void
  onRemove: () => void
  onPush: (machineId: string) => void
}

/** Everything that can be done to one account besides making it the one new sessions use. */
export function SealAccountCardMenu({
  account,
  pushTargets,
  onRelogin,
  onEdit,
  onRemove,
  onPush
}: SealAccountCardMenuProps): React.JSX.Element {
  const t = useTranslate()
  const { candidate } = account
  const isLogin = candidate.credential === 'login'
  // Only a login on this computer can be copied elsewhere; keys stay in their own keychain.
  const canPush = isLogin && account.onHome && candidate.launchable && pushTargets.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          data-slot="seal-account-menu"
          aria-label={t('seal.accounts.action.more', 'Actions for {{value0}}', {
            value0: candidate.label
          })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          {t('seal.accounts.action.rename', 'Rename and limits…')}
        </DropdownMenuItem>
        {isLogin ? (
          <DropdownMenuItem onSelect={onRelogin}>
            <LogIn />
            {t('seal.accounts.action.reloginMenu', 'Sign in again…')}
          </DropdownMenuItem>
        ) : null}
        {canPush ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Send />
              {t('seal.accounts.action.push', 'Push to machine')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {pushTargets.map((machine) => {
                const held = account.machines.some((entry) => entry.machineId === machine.id)
                return (
                  <DropdownMenuItem key={machine.id} onSelect={() => onPush(machine.id)}>
                    <span className="truncate">{machine.label}</span>
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">
                      {held
                        ? t('seal.accounts.action.pushUpdate', 'Update login')
                        : t('seal.accounts.action.pushCopy', 'Copy login')}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Trash2 />
          {t('seal.accounts.action.remove', 'Remove…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
