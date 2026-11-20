import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import type {
  Connector,
  SignInRef
} from '../../../../../shared/seal-connectors/seal-connectors-types'
import {
  AgentConfigConfirmDialog,
  type AgentConfigConfirmRequest
} from '../../agent-config/AgentConfigConfirmDialog'
import { SettingsBadge } from '../form-controls/SettingsFormControls'
import { AppliesToEditor } from './applies-to/AppliesToEditor'
import type { AppliesToOptions } from './applies-to/use-applies-to-options'
import { ConnectorSignInButton } from './ConnectorSignInButton'
import { ConnectorSourceBadge, pluginNameOf } from './ConnectorSourceBadge'
import { ConnectorSheetSection as SheetSection } from './ConnectorSheetSection'
import { ConnectorSignInRow as SignInRow } from './ConnectorSignInRow'
import { connectorsCall, type SealConnectors } from './use-seal-connectors'

function ToolsSection({
  connector,
  onChange
}: {
  connector: Connector
  onChange: (disabledTools: string[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [name, setName] = useState('')
  const add = (): void => {
    const next = name.trim()
    if (next && !connector.disabledTools.includes(next)) {
      onChange([...connector.disabledTools, next])
    }
    setName('')
  }
  return (
    <SheetSection
      title={t('seal.connectors.sheet.tools', 'Tools turned off')}
      description={t(
        'seal.connectors.sheet.toolsDescription',
        'Agents cannot call these tools. Type a tool’s name as the connector lists it.'
      )}
    >
      {connector.disabledTools.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {connector.disabledTools.map((tool) => (
            <span
              key={tool}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/30 py-0.5 pr-0.5 pl-2 font-mono text-xs"
            >
              <span className="truncate">{tool}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('seal.connectors.sheet.enableTool', 'Turn {{tool}} back on', {
                  tool
                })}
                onClick={() => onChange(connector.disabledTools.filter((entry) => entry !== tool))}
              >
                <X />
              </Button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('seal.connectors.sheet.allToolsOn', 'Every tool is on.')}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={name}
          spellCheck={false}
          variant="code"
          placeholder={t('seal.connectors.sheet.toolPlaceholder', 'tool_name')}
          aria-label={t('seal.connectors.sheet.toolLabel', 'Tool to turn off')}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button variant="outline" size="sm" disabled={!name.trim()} onClick={add}>
          <Plus />
          {t('seal.connectors.sheet.turnOff', 'Turn off')}
        </Button>
      </div>
    </SheetSection>
  )
}

/** Everything about one connector: its sign-ins, tools, who gets it, and removal. */
export function ConnectorSheet({
  connector,
  connectors,
  options,
  now,
  onClose
}: {
  connector: Connector | null
  connectors: SealConnectors
  options: AppliesToOptions
  now: number
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [confirm, setConfirm] = useState<AgentConfigConfirmRequest | null>(null)
  const imported = connector?.source.kind === 'imported' ? connector.source : null
  const importedFrom = imported
    ? (connectors.fleet?.hosts.find((host) => host.status?.hostKey === imported.fromHostKey)
        ?.label ?? imported.fromHostKey)
    : null

  const update = (patch: Partial<Connector>): void => {
    if (!connector) {
      return
    }
    void connectors.editConfig((config) => ({
      ...config,
      connectors: config.connectors.map((entry) =>
        entry.id === connector.id ? { ...entry, ...patch } : entry
      )
    }))
  }

  const removeConnector = (): void => {
    if (!connector) {
      return
    }
    setConfirm({
      title: t('seal.connectors.sheet.removeTitle', 'Remove {{title}}?', {
        title: connector.title
      }),
      description: t(
        'seal.connectors.sheet.removeDescription',
        'Agents stop getting it on every machine and its sign-ins are deleted.'
      ),
      confirmLabel: t('seal.connectors.sheet.remove', 'Remove connector'),
      destructive: true,
      run: async () => {
        const saved = await connectors.editConfig((config) => ({
          ...config,
          connectors: config.connectors.filter((entry) => entry.id !== connector.id)
        }))
        if (saved) {
          onClose()
        }
      }
    })
  }

  const removeSignIn = (signIn: SignInRef): void => {
    if (!connector) {
      return
    }
    setConfirm({
      title: t('seal.connectors.sheet.removeSignInTitle', 'Remove {{label}}?', {
        label: signIn.label
      }),
      description: t(
        'seal.connectors.sheet.removeSignInDescription',
        'Its tokens are deleted from every machine. Connect again to get them back.'
      ),
      confirmLabel: t('seal.connectors.sheet.removeSignIn', 'Remove sign-in'),
      destructive: true,
      run: async () => {
        await connectorsCall('seal.connectors.removeSignIn', {
          connectorId: connector.id,
          signInId: signIn.id
        })
        await connectors.refresh()
      }
    })
  }

  return (
    <>
      <Sheet open={connector !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="sm:max-w-xl" data-slot="connector-sheet">
          {connector ? (
            <>
              <div className="border-b border-border pr-12">
                <SheetHeader>
                  <SheetTitle>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate">{connector.title}</span>
                      <ConnectorSourceBadge source={connector.source} />
                    </span>
                  </SheetTitle>
                  <SheetDescription>
                    <span
                      className="block truncate font-mono text-xs"
                      title={transportText(connector)}
                    >
                      {transportText(connector)}
                    </span>
                  </SheetDescription>
                  {imported && importedFrom !== null ? (
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'seal.connectors.sheet.importedFrom',
                        'Imported from {{agent}} on {{machine}}.',
                        {
                          agent: imported.fromHarness === 'codex' ? 'Codex' : 'Claude Code',
                          machine: importedFrom
                        }
                      )}
                    </p>
                  ) : null}
                  {connector.source.kind === 'plugin' ? (
                    <p className="text-xs text-muted-foreground">
                      {t('seal.connectors.sheet.comesWith', 'Comes with the {{plugin}} plugin.', {
                        plugin: pluginNameOf(connector.source.pluginId)
                      })}
                    </p>
                  ) : null}
                </SheetHeader>
              </div>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-8 scrollbar-sleek">
                <SheetSection
                  title={t('seal.connectors.sheet.enabled', 'Use this connector')}
                  action={
                    <Switch
                      checked={connector.enabled}
                      aria-label={t('seal.connectors.sheet.enabled', 'Use this connector')}
                      onCheckedChange={(enabled) => update({ enabled })}
                    />
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SettingsBadge tone="muted">
                      {connector.auth === 'oauth'
                        ? t('seal.connectors.sheet.authOauth', 'Signs in with OAuth')
                        : connector.auth === 'static'
                          ? t('seal.connectors.sheet.authStatic', 'Uses a key')
                          : t('seal.connectors.sheet.authNone', 'No sign-in')}
                    </SettingsBadge>
                  </div>
                </SheetSection>
                {connector.auth !== 'none' ? (
                  <SheetSection
                    title={t('seal.connectors.sheet.signIns', 'Sign-ins')}
                    description={t(
                      'seal.connectors.sheet.signInsDescription',
                      'Add one per account or workspace, then choose where each applies.'
                    )}
                    action={
                      <ConnectorSignInButton
                        connector={connector}
                        label={
                          connector.signIns.length === 0
                            ? t('seal.connectors.signIn.connect', 'Connect')
                            : t('seal.connectors.sheet.addAnother', 'Add another sign-in')
                        }
                        variant={connector.signIns.length === 0 ? 'default' : 'outline'}
                        onDone={() => void connectors.refresh()}
                      />
                    }
                  >
                    {connector.signIns.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t('seal.connectors.sheet.noSignIns', 'No one is signed in yet.')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {connector.signIns.map((signIn) => (
                          <SignInRow
                            key={signIn.id}
                            connector={connector}
                            signIn={signIn}
                            connectors={connectors}
                            options={options}
                            now={now}
                            onRemove={() => removeSignIn(signIn)}
                          />
                        ))}
                      </div>
                    )}
                  </SheetSection>
                ) : null}
                <ToolsSection
                  connector={connector}
                  onChange={(disabledTools) => update({ disabledTools })}
                />
                <SheetSection
                  title={t('seal.connectors.sheet.appliesTo', 'Applies to')}
                  description={t(
                    'seal.connectors.sheet.appliesToDescription',
                    'Which machines, accounts and agents get this connector.'
                  )}
                >
                  <AppliesToEditor
                    value={connector}
                    options={options}
                    onChange={(next) => update(next)}
                  />
                </SheetSection>
                {connector.source.kind !== 'plugin' ? (
                  <SheetSection title={t('seal.connectors.sheet.dangerZone', 'Remove')}>
                    <Button variant="destructive" size="sm" onClick={removeConnector}>
                      <Trash2 />
                      {t('seal.connectors.sheet.remove', 'Remove connector')}
                    </Button>
                  </SheetSection>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      <AgentConfigConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

function transportText(connector: Connector): string {
  return connector.transport.type === 'http'
    ? connector.transport.url
    : [connector.transport.command, ...connector.transport.args].join(' ')
}
