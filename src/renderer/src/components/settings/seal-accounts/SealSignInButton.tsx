import { LogIn } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealAccountKey } from '../../../../../shared/seal-accounts/seal-accounts-config'
import { Button } from '../../ui/button'
import { requestSealRelogin } from './seal-accounts-navigation'

/** One click to sign a Seal account in again, from anywhere it shows as signed out. */
export function SealSignInButton({
  accountKey,
  size = 'xs'
}: {
  accountKey: SealAccountKey
  size?: 'xs' | 'sm'
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Button
      variant="outline"
      size={size}
      onClick={(event) => {
        event.stopPropagation()
        requestSealRelogin(accountKey)
      }}
      data-slot="seal-sign-in-button"
    >
      <LogIn />
      {t('seal.accounts.action.signIn', 'Sign in')}
    </Button>
  )
}
