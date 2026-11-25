import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import type {
  Connector,
  SignInRef
} from '../../../../../shared/seal-connectors/seal-connectors-types'
import { AppliesToChip } from './applies-to/AppliesToChip'
import { AppliesToEditor, type AppliesToValue } from './applies-to/AppliesToEditor'
import type { AppliesToOptions } from './applies-to/use-applies-to-options'
import { ConnectorSignInButton } from './ConnectorSignInButton'
import { ConnectorStatusPill } from './ConnectorStatusPill'
import { signInStateOfOwnHost } from './seal-connector-status'
import type { SealConnectors } from './use-seal-connectors'

export function ConnectorSignInRow({
  connector,
  signIn,
  connectors,
  options,
  now,
  onRemove
}: {
  connector: Connector
  signIn: SignInRef
  connectors: SealConnectors
  options: AppliesToOptions
  now: number
  onRemove: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [label, setLabel] = useState(signIn.label)
  const [editing, setEditing] = useState(false)
  const update = (patch: Partial<SignInRef>): void => {
    void connectors.editConfig((config) => ({
      ...config,
      connectors: config.connectors.map((entry) =>
        entry.id === connector.id
          ? {
              ...entry,
              signIns: entry.signIns.map((item) =>
                item.id === signIn.id ? { ...item, ...patch } : item
              )
            }
          : entry
      )
    }))
  }
  const commitLabel = (): void => {
    const next = label.trim()
    if (next && next !== signIn.label) {
      update({ label: next })
    } else {
      setLabel(signIn.label)
    }
  }
  const state = signInStateOfOwnHost(signIn, connectors.status?.signIns ?? [], now)
  const value: AppliesToValue = signIn
  return (
    <div
      className="space-y-2 rounded-lg border border-border p-3"
      data-connector-sign-in={signIn.id}
    >
      <div className="flex items-center gap-2">
        <Input
          value={label}
          maxLength={120}
          title={label}
          aria-label={t('seal.connectors.sheet.signInLabel', 'Sign-in name')}
          density="compact"
          className="min-w-0 flex-1"
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
        <Switch
          checked={signIn.enabled}
          aria-label={t('seal.connectors.sheet.signInEnabled', 'Use this sign-in')}
          onCheckedChange={(enabled) => update({ enabled })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {connector.auth === 'oauth' ? <ConnectorStatusPill state={state} /> : null}
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-expanded={editing}
          onClick={() => setEditing((open) => !open)}
        >
          <AppliesToChip value={signIn} options={options} />
        </button>
        <div className="ml-auto flex items-center gap-1">
          <ConnectorSignInButton
            connector={connector}
            signInId={signIn.id}
            onDone={() => void connectors.refresh()}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('seal.connectors.sheet.removeSignIn', 'Remove sign-in')}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {editing ? (
        <AppliesToEditor value={value} options={options} onChange={(next) => update(next)} />
      ) : null}
    </div>
  )
}
