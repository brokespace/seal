import { useState } from 'react'
import { ChevronRight, Download, Globe, KeyRound, Smartphone } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealProvider } from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import type {
  SealAccountGroup,
  SealFleetAccount
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import type { SealSignInMethod } from '../../../../../shared/seal-accounts/seal-sign-in'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import { SealSecretForm, type SealSecretInput } from './SealSecretForm'
import { SealSignInProgress } from './SealSignInProgress'
import type { SealSignInController } from './use-seal-sign-in'

type View = 'methods' | 'sign-in' | 'setup-token'

export type SealAddAccountDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialGroup: SealAccountGroup
  /** The account to sign in again; null when adding a new one. */
  relogin: SealFleetAccount | null
  status: SealAccountsStatus
  signIn: SealSignInController
  onImportSystemLogin: (provider: SealProvider) => Promise<boolean>
  onAddSecret: (input: SealSecretInput) => Promise<boolean>
}

function MethodRow({
  icon,
  title,
  description,
  slot,
  disabled,
  onSelect
}: {
  icon: React.ReactNode
  title: string
  description: string
  slot: string
  disabled?: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      data-slot={slot}
      className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

/** Adds an account by any supported route, or signs an existing one in again. */
export function SealAddAccountDialog({
  open,
  onOpenChange,
  initialGroup,
  relogin,
  status,
  signIn,
  onImportSystemLogin,
  onAddSecret
}: SealAddAccountDialogProps): React.JSX.Element {
  const t = useTranslate()
  const [group, setGroup] = useState<SealAccountGroup>(relogin?.provider ?? initialGroup)
  // A sign-in that is still running when the dialog opens is shown rather than restarted.
  const [view, setView] = useState<View>(signIn.status ? 'sign-in' : 'methods')
  const [method, setMethod] = useState<SealSignInMethod>('browser')
  const [importing, setImporting] = useState(false)
  const provider: SealProvider = group === 'codex' ? 'codex' : 'claude'
  const cli = provider === 'claude' ? 'claude' : 'codex'
  const systemLogin = status.systemLogins?.[provider] ?? null

  const close = (): void => {
    signIn.reset()
    onOpenChange(false)
  }
  const back = (): void => {
    signIn.reset()
    setView('methods')
  }
  const startSignIn = (next: SealSignInMethod): void => {
    setMethod(next)
    setView('sign-in')
    signIn.start({
      provider,
      method: next,
      openBrowser: next === 'browser',
      ...(relogin ? { account: relogin.key } : {})
    })
  }
  const importLogin = async (): Promise<void> => {
    setImporting(true)
    const ok = await onImportSystemLogin(provider)
    setImporting(false)
    if (ok) {
      close()
    }
  }

  const browserRow = (
    <MethodRow
      slot="seal-add-browser"
      icon={<Globe />}
      title={t('seal.accounts.add.browser', 'Sign in with your browser')}
      description={
        provider === 'claude'
          ? t(
              'seal.accounts.add.browserClaude',
              'Runs `claude` login in a folder of its own, so it never touches your other logins.'
            )
          : t(
              'seal.accounts.add.browserCodex',
              'Runs `codex login` in a CODEX_HOME of its own, so it never touches your other logins.'
            )
      }
      onSelect={() => startSignIn('browser')}
    />
  )
  const deviceRow = (
    <MethodRow
      slot="seal-add-device"
      icon={<Smartphone />}
      title={t('seal.accounts.add.device', 'Sign in with a device code')}
      description={t(
        'seal.accounts.add.deviceDescription',
        'Shows a short code to enter on any device. Use it when a browser cannot reach this computer.'
      )}
      onSelect={() => startSignIn('device-code')}
    />
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg" data-slot="seal-add-account-dialog">
        <DialogHeader>
          <DialogTitle>
            {relogin
              ? t('seal.accounts.add.reloginTitle', 'Sign in again to {{value0}}', {
                  value0: relogin.candidate.label
                })
              : t('seal.accounts.add.title', 'Add an account')}
          </DialogTitle>
          <DialogDescription>
            {relogin
              ? t(
                  'seal.accounts.add.reloginDescription',
                  'Sign in as the same account to replace its login. Sessions keep running.'
                )
              : t(
                  'seal.accounts.add.description',
                  'The account is saved on this computer. Push it to other machines from its card.'
                )}
          </DialogDescription>
        </DialogHeader>
        {relogin || view !== 'methods' ? null : (
          <SettingsSegmentedControl
            size="sm"
            equalWidth
            value={group}
            onChange={setGroup}
            ariaLabel={t('seal.accounts.add.kind', 'Kind of account')}
            options={[
              { value: 'claude', label: t('seal.accounts.group.claude', 'Claude') },
              { value: 'codex', label: t('seal.accounts.group.codex', 'Codex') },
              { value: 'apiKeys', label: t('seal.accounts.group.apiKey', 'API key') }
            ]}
          />
        )}
        {view === 'sign-in' ? (
          <SealSignInProgress
            provider={provider}
            signIn={signIn}
            opensBrowser={method === 'browser'}
            onRetry={() => startSignIn(method)}
            onBack={back}
            onDone={close}
          />
        ) : view === 'setup-token' ? (
          <SealSecretForm
            kind="setup-token"
            secretStorage={status.secretStorage}
            onCancel={back}
            onSave={async (input) => {
              const ok = await onAddSecret(input)
              if (ok) {
                close()
              }
              return ok
            }}
          />
        ) : group === 'apiKeys' ? (
          <SealSecretForm
            kind="api-key"
            secretStorage={status.secretStorage}
            onCancel={close}
            onSave={async (input) => {
              const ok = await onAddSecret(input)
              if (ok) {
                close()
              }
              return ok
            }}
          />
        ) : (
          <div className="grid gap-2" data-slot="seal-add-methods">
            {browserRow}
            {provider === 'codex' ? deviceRow : null}
            {relogin ? null : (
              <MethodRow
                slot="seal-add-import"
                icon={<Download />}
                disabled={importing || systemLogin?.state !== 'dismissed'}
                title={t('seal.accounts.add.import', 'Use the login already on this computer')}
                description={
                  systemLogin === null
                    ? t(
                        'seal.accounts.add.importNone',
                        'The `{{value0}}` CLI on this computer is not signed in.',
                        { value0: cli }
                      )
                    : systemLogin.state === 'listed'
                      ? t('seal.accounts.add.importListed', '{{value0}} is already in the list.', {
                          value0: systemLogin.email
                        })
                      : t(
                          'seal.accounts.add.importAvailable',
                          'Lists {{value0}}, the account `{{value1}}` is signed in to. Nothing is copied.',
                          { value0: systemLogin.email, value1: cli }
                        )
                }
                onSelect={() => void importLogin()}
              />
            )}
            {relogin || provider !== 'claude' ? null : (
              <MethodRow
                slot="seal-add-setup-token"
                icon={<KeyRound />}
                title={t('seal.accounts.add.setupToken', 'Paste a setup token')}
                description={t(
                  'seal.accounts.add.setupTokenDescription',
                  'A one-year token from `claude setup-token`, for a subscription you cannot sign in to here.'
                )}
                onSelect={() => setView('setup-token')}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
