import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import {
  APPLIES_TO_ALL,
  SERVER_NAME_PATTERN,
  type Connector,
  type ConnectorTransport
} from '../../../../../shared/seal-connectors/seal-connectors-types'
import { AgentPluginsBrowse } from '../../agent-plugins/AgentPluginsBrowse'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import { useInstallPlugin } from './plugins/use-install-plugin'
import type { SealConnectors } from './use-seal-connectors'

// Literal examples of what to type; they are not words to translate.
const URL_PLACEHOLDER = 'https://mcp.example.com/mcp'
const COMMAND_PLACEHOLDER = 'npx'
const ARGS_PLACEHOLDER = '-y @acme/mcp-server'
const ENV_PLACEHOLDER = 'REGION=eu'

type Kind = 'http' | 'stdio'
type HttpAuth = Connector['auth']

/** `Acme Docs` becomes `acme-docs`, the name sessions see. */
export function connectorServerName(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'connector'
  let name = SERVER_NAME_PATTERN.test(base) ? base : `c-${base}`
  for (let suffix = 2; taken.has(name); suffix += 1) {
    name = `${base}-${suffix}`
  }
  return name
}

function parseArgs(text: string): string[] {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((part) =>
    part.replace(/^(["'])(.*)\1$/, '$2')
  )
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) {
      env[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
  }
  return env
}

function CustomConnectorForm({
  connectors,
  onCreated,
  onCancel
}: {
  connectors: SealConnectors
  onCreated: (id: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [kind, setKind] = useState<Kind>('http')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [auth, setAuth] = useState<HttpAuth>('oauth')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const urlOk = /^https?:\/\/\S+$/.test(url.trim())
  const valid = title.trim() !== '' && (kind === 'http' ? urlOk : command.trim() !== '')

  const create = async (): Promise<void> => {
    const taken = new Set((connectors.config?.connectors ?? []).map((entry) => entry.name))
    const transport: ConnectorTransport =
      kind === 'http'
        ? { type: 'http', url: url.trim() }
        : { type: 'stdio', command: command.trim(), args: parseArgs(args), env: parseEnv(env) }
    const connector: Connector = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: connectorServerName(title, taken),
      title: title.trim(),
      transport,
      source: { kind: 'custom' },
      auth: kind === 'http' ? auth : 'none',
      signIns: [],
      disabledTools: [],
      enabled: true,
      appliesTo: APPLIES_TO_ALL,
      projectOverrides: []
    }
    const saved = await connectors.editConfig((config) => ({
      ...config,
      connectors: [...config.connectors, connector]
    }))
    if (saved) {
      onCreated(connector.id)
    }
  }

  return (
    <div className="grid gap-3">
      <SettingsSegmentedControl
        size="sm"
        value={kind}
        onChange={setKind}
        ariaLabel={t('seal.connectors.add.kind', 'Connector type')}
        options={[
          { value: 'http', label: t('seal.connectors.add.http', 'Web address') },
          { value: 'stdio', label: t('seal.connectors.add.stdio', 'Command') }
        ]}
      />
      <div className="grid gap-1">
        <Label htmlFor="connector-title">{t('seal.connectors.add.title', 'Name')}</Label>
        <Input
          id="connector-title"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      {kind === 'http' ? (
        <>
          <div className="grid gap-1">
            <Label htmlFor="connector-url">{t('seal.connectors.add.url', 'MCP server URL')}</Label>
            <Input
              id="connector-url"
              value={url}
              spellCheck={false}
              placeholder={URL_PLACEHOLDER}
              aria-invalid={url.trim() !== '' && !urlOk}
              variant="code"
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>{t('seal.connectors.add.auth', 'Authentication')}</Label>
            <SettingsSegmentedControl
              size="sm"
              value={auth}
              onChange={setAuth}
              ariaLabel={t('seal.connectors.add.auth', 'Authentication')}
              options={[
                { value: 'oauth', label: t('seal.connectors.add.authOauth', 'OAuth') },
                { value: 'none', label: t('seal.connectors.add.authNone', 'None') },
                { value: 'static', label: t('seal.connectors.add.authStatic', 'Static headers') }
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {auth === 'oauth'
                ? t(
                    'seal.connectors.add.authOauthHelp',
                    'You approve access in the browser after adding it.'
                  )
                : auth === 'static'
                  ? t(
                      'seal.connectors.add.authStaticHelp',
                      'You enter the header values after adding it. They stay encrypted.'
                    )
                  : t('seal.connectors.add.authNoneHelp', 'The server needs no sign-in.')}
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-1">
            <Label htmlFor="connector-command">{t('seal.connectors.add.command', 'Command')}</Label>
            <Input
              id="connector-command"
              value={command}
              spellCheck={false}
              placeholder={COMMAND_PLACEHOLDER}
              variant="code"
              onChange={(event) => setCommand(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="connector-args">{t('seal.connectors.add.args', 'Arguments')}</Label>
            <Input
              id="connector-args"
              value={args}
              spellCheck={false}
              placeholder={ARGS_PLACEHOLDER}
              variant="code"
              onChange={(event) => setArgs(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="connector-env">
              {t('seal.connectors.add.env', 'Environment variables, one per line')}
            </Label>
            <Textarea
              id="connector-env"
              rows={3}
              value={env}
              spellCheck={false}
              placeholder={ENV_PLACEHOLDER}
              variant="code"
              onChange={(event) => setEnv(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'seal.connectors.add.envHelp',
                'Saved in the connector list as plain text. Keep secrets out of it.'
              )}
            </p>
          </div>
        </>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {t('seal.accounts.cancel', 'Cancel')}
        </Button>
        <Button disabled={!valid} onClick={() => void create()}>
          {t('seal.connectors.add.create', 'Add connector')}
        </Button>
      </DialogFooter>
    </div>
  )
}

/** Add a connector from the marketplaces (plugins that bring MCP servers) or by hand. */
export function AddConnectorDialog({
  connectors,
  onCreated,
  onClose
}: {
  connectors: SealConnectors
  onCreated: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const install = useInstallPlugin(connectors)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent scrollable className="sm:max-w-2xl" data-slot="add-connector">
        <DialogHeader>
          <DialogTitle>{t('seal.connectors.add.heading', 'Add connector')}</DialogTitle>
          <DialogDescription>
            {t(
              'seal.connectors.add.description',
              'Pick one from Claude Code’s and Codex’s marketplaces, or add your own server.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="catalog">
          <TabsList size="sm">
            <TabsTrigger value="catalog">{t('seal.connectors.add.catalog', 'Catalog')}</TabsTrigger>
            <TabsTrigger value="custom">{t('seal.connectors.add.custom', 'Custom')}</TabsTrigger>
          </TabsList>
          <TabsContent value="catalog" className="mt-3">
            <AgentPluginsBrowse
              onlyMcp
              installed={install.installed}
              installing={install.installing}
              onInstall={(entry, listing) =>
                void install.run(entry.name, listing).then((ok) => {
                  if (ok) {
                    toast.success(
                      t(
                        'seal.connectors.add.installed',
                        '{{name}} added. Connect it from the list.',
                        {
                          name: entry.name
                        }
                      )
                    )
                    onClose()
                  }
                })
              }
            />
          </TabsContent>
          <TabsContent value="custom" className="mt-3">
            <CustomConnectorForm connectors={connectors} onCreated={onCreated} onCancel={onClose} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
