import { useState } from 'react'
import { Download, KeyRound, Plus } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import {
  SEAL_PROVIDERS,
  type SealProvider
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import type { SealAccountGroup } from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { Button } from '../../ui/button'

type SealAccountsOnboardingProps = {
  status: SealAccountsStatus
  onAdd: (group: SealAccountGroup) => void
  onImportSystemLogin: (provider: SealProvider) => Promise<boolean>
}

/** The page with no accounts: what accounts are for, and the shortest ways to add the first one. */
export function SealAccountsOnboarding({
  status,
  onAdd,
  onImportSystemLogin
}: SealAccountsOnboardingProps): React.JSX.Element {
  const t = useTranslate()
  const [importing, setImporting] = useState<SealProvider | null>(null)
  // Logins the person removed from Seal earlier are one click away from coming back.
  const importable = SEAL_PROVIDERS.flatMap((provider) => {
    const login = status.systemLogins?.[provider]
    return login?.state === 'dismissed' ? [{ provider, email: login.email }] : []
  })
  const runImport = async (provider: SealProvider): Promise<void> => {
    setImporting(provider)
    await onImportSystemLogin(provider)
    setImporting(null)
  }
  return (
    <section
      className="rounded-xl border border-border bg-card/50 px-6 py-8 shadow-xs"
      data-slot="seal-accounts-onboarding"
    >
      <h3 className="text-base font-semibold">
        {t('seal.accounts.onboarding.title', 'Add your first account')}
      </h3>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {t(
          'seal.accounts.onboarding.body',
          'Seal runs Claude Code and Codex on the accounts you add here. With two or more, it watches each account’s 5-hour and 7-day usage and moves work to the next one before a limit stops you.'
        )}
      </p>
      <ol className="mt-4 max-w-prose list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          {t(
            'seal.accounts.onboarding.step1',
            'Add each subscription. Every sign-in gets a folder of its own, so accounts never overwrite each other.'
          )}
        </li>
        <li>
          {t(
            'seal.accounts.onboarding.step2',
            'Drag accounts into the order you prefer, and turn on auto-swap.'
          )}
        </li>
        <li>
          {t(
            'seal.accounts.onboarding.step3',
            'Optionally pin projects or machines to specific accounts with rules, and push logins to your other machines.'
          )}
        </li>
      </ol>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onAdd('claude')} data-slot="seal-onboarding-claude">
          <Plus />
          {t('seal.accounts.onboarding.addClaude', 'Add Claude account')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAdd('codex')}
          data-slot="seal-onboarding-codex"
        >
          <Plus />
          {t('seal.accounts.onboarding.addCodex', 'Add Codex account')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAdd('apiKeys')}>
          <KeyRound />
          {t('seal.accounts.add.apiKey', 'Add API key')}
        </Button>
      </div>
      {importable.length > 0 ? (
        <div className="mt-5 space-y-2 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {t(
              'seal.accounts.onboarding.importHint',
              'This computer’s own CLI is already signed in. Use that login without signing in again:'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {importable.map((entry) => (
              <Button
                key={entry.provider}
                size="sm"
                variant="outline"
                disabled={importing !== null}
                onClick={() => void runImport(entry.provider)}
                data-slot={`seal-onboarding-import-${entry.provider}`}
              >
                <Download />
                {entry.provider === 'claude'
                  ? t('seal.accounts.onboarding.importClaude', 'Use Claude login {{value0}}', {
                      value0: entry.email
                    })
                  : t('seal.accounts.onboarding.importCodex', 'Use Codex login {{value0}}', {
                      value0: entry.email
                    })}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
