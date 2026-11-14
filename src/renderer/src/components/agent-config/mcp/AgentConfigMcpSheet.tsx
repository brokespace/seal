import React, { useState } from 'react'
import { Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import { agentConfigMcpScopes } from '../../../../../shared/agent-config/agent-config-mcp-scopes'
import {
  mcpCodec,
  validateMcpDraft
} from '../../../../../shared/agent-config/agent-config-mcp-codec'
import type {
  AgentConfigMcpServer,
  AgentConfigMcpTransport,
  AgentConfigScope
} from '../../../../../shared/agent-config/agent-config-types'
import {
  AgentConfigPairsField,
  pairsFromRecord,
  recordFromPairs,
  type AgentConfigPair
} from '../AgentConfigPairsField'
import { agentConfigApi, agentConfigErrorText } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'
import { agentConfigScopeHint, agentConfigScopeLabel } from '../model/agent-config-scope-labels'

/** `server: null` adds one. */
export type AgentConfigMcpEdit = { server: AgentConfigMcpServer | null; scope: AgentConfigScope }

type Form = {
  name: string
  transport: AgentConfigMcpTransport
  command: string
  args: string
  env: AgentConfigPair[]
  url: string
  headers: AgentConfigPair[]
  enabled: boolean
}

function formOf(server: AgentConfigMcpServer | null): Form {
  return {
    name: server?.name ?? '',
    transport: server?.transport ?? 'stdio',
    command: server?.command ?? '',
    args: (server?.args ?? []).join('\n'),
    env: pairsFromRecord(server?.env ?? {}),
    url: server?.url ?? '',
    headers: pairsFromRecord(server?.headers ?? {}),
    enabled: server?.enabled ?? true
  }
}

function field(
  id: string,
  label: string,
  control: React.ReactNode,
  hint?: string
): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {control}
    </div>
  )
}

export function AgentConfigMcpSheet({
  edit,
  onClose
}: {
  edit: AgentConfigMcpEdit | null
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { layout, target, reload } = useAgentConfig()
  const [form, setForm] = useState<Form>(() => formOf(null))
  const [scope, setScope] = useState<AgentConfigScope>('user')
  const [revealing, setRevealing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<AgentConfigMcpEdit | null>(null)
  if (seededFor !== edit) {
    setSeededFor(edit)
    setForm(formOf(edit?.server ?? null))
    setScope(edit?.scope ?? 'user')
    setError(null)
    setSaving(false)
  }
  const server = edit?.server ?? null
  const scopes = agentConfigMcpScopes(layout, Boolean(target.projectPath))
  const place = scopes.find((item) => item.scope === scope) ?? scopes[0]
  const codec = mcpCodec(place?.codec ?? 'generic')
  const set = (change: Partial<Form>): void => setForm((previous) => ({ ...previous, ...change }))
  const draft = {
    name: form.name.trim(),
    transport: form.transport,
    command: form.command.trim(),
    args: form.args.split('\n').filter((line) => line !== ''),
    env: recordFromPairs(form.env),
    url: form.url.trim(),
    headers: recordFromPairs(form.headers),
    enabled: form.enabled
  }
  const problems = validateMcpDraft(draft, codec)
  const hidden = (server?.maskedFields.length ?? 0) > 0

  const reveal = async (): Promise<void> => {
    if (!server) {
      return
    }
    setRevealing(true)
    try {
      const full = await agentConfigApi().revealMcpServer({
        target,
        scope: server.scope,
        name: server.name
      })
      set({
        args: full.args.join('\n'),
        env: pairsFromRecord(full.env),
        url: full.url,
        headers: pairsFromRecord(full.headers)
      })
    } catch (failure) {
      setError(agentConfigErrorText(failure))
    }
    setRevealing(false)
  }

  const save = async (): Promise<void> => {
    if (!place || saving || problems.length > 0) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      await agentConfigApi().saveMcpServer({
        target,
        scope: place.scope,
        ...(server ? { originalName: server.name } : {}),
        draft
      })
      toast.success(
        t('auto.components.agentConfig.mcp.saved', 'Saved {{name}}', { name: draft.name })
      )
      reload()
      onClose()
    } catch (failure) {
      setError(agentConfigErrorText(failure))
      setSaving(false)
    }
  }

  return (
    <Sheet open={edit !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent data-agent-config-mcp-form>
        <div className="shrink-0 border-b border-border pr-8">
          <SheetHeader>
            <SheetTitle>
              {server
                ? t('auto.components.agentConfig.mcp.editTitle', 'Edit {{name}}', {
                    name: server.name
                  })
                : t('auto.components.agentConfig.mcp.addTitle', 'Add an MCP server')}
            </SheetTitle>
            <SheetDescription>
              <span className="font-mono text-xs [overflow-wrap:anywhere]">
                {server?.sourcePath ?? place?.file}
              </span>
            </SheetDescription>
          </SheetHeader>
        </div>
        <div className="scrollbar-sleek min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {server || scopes.length < 2
            ? null
            : field(
                'agent-config-mcp-scope',
                t('auto.components.agentConfig.mcp.scope', 'Available in'),
                <Select
                  value={scope}
                  onValueChange={(value) => {
                    const chosen = scopes.find((item) => item.scope === value)
                    if (chosen) {
                      setScope(chosen.scope)
                    }
                  }}
                >
                  <SelectTrigger id="agent-config-mcp-scope" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scopes.map((item) => (
                      <SelectItem key={item.scope} value={item.scope}>
                        {agentConfigScopeLabel(item.scope, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>,
                agentConfigScopeHint(scope, t)
              )}
          {field(
            'agent-config-mcp-name',
            t('auto.components.agentConfig.name', 'Name'),
            <Input
              id="agent-config-mcp-name"
              autoFocus={!server}
              value={form.name}
              className="font-mono text-xs"
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
          {field(
            'agent-config-mcp-transport',
            t('auto.components.agentConfig.mcp.transport', 'Connection'),
            <Select
              value={form.transport}
              onValueChange={(value) => {
                if (value === 'stdio' || value === 'http' || value === 'sse') {
                  set({ transport: value })
                }
              }}
            >
              <SelectTrigger id="agent-config-mcp-transport" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {codec.transports.map((transport) => (
                  <SelectItem key={transport} value={transport}>
                    {transport === 'stdio'
                      ? t(
                          'auto.components.agentConfig.mcp.stdio',
                          'stdio: a command on the machine'
                        )
                      : transport === 'http'
                        ? t('auto.components.agentConfig.mcp.http', 'HTTP: a URL')
                        : t('auto.components.agentConfig.mcp.sse', 'SSE: a URL (older servers)')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {form.transport === 'stdio' ? (
            <>
              {field(
                'agent-config-mcp-command',
                t('auto.components.agentConfig.mcp.command', 'Command'),
                <Input
                  id="agent-config-mcp-command"
                  value={form.command}
                  className="font-mono text-xs"
                  placeholder={t('auto.components.agentConfig.example.command', 'npx')}
                  onChange={(event) => set({ command: event.target.value })}
                />
              )}
              {field(
                'agent-config-mcp-args',
                t('auto.components.agentConfig.mcp.args', 'Arguments'),
                <Textarea
                  id="agent-config-mcp-args"
                  value={form.args}
                  rows={3}
                  className="font-mono text-xs"
                  placeholder={t('auto.components.agentConfig.example.args', '-y\n@scope/server')}
                  onChange={(event) => set({ args: event.target.value })}
                />,
                t('auto.components.agentConfig.mcp.argsHint', 'One per line.')
              )}
              {field(
                'agent-config-mcp-env',
                t('auto.components.agentConfig.mcp.env', 'Environment variables'),
                <AgentConfigPairsField
                  label={t('auto.components.agentConfig.mcp.env', 'Environment variables')}
                  pairs={form.env}
                  keyPlaceholder="NAME"
                  valuePlaceholder={t('auto.components.agentConfig.value', 'value')}
                  onChange={(env) => set({ env })}
                />
              )}
            </>
          ) : (
            <>
              {field(
                'agent-config-mcp-url',
                t('auto.components.agentConfig.mcp.url', 'URL'),
                <Input
                  id="agent-config-mcp-url"
                  value={form.url}
                  className="font-mono text-xs"
                  placeholder={t(
                    'auto.components.agentConfig.example.url',
                    'https://example.com/mcp'
                  )}
                  onChange={(event) => set({ url: event.target.value })}
                />
              )}
              {field(
                'agent-config-mcp-headers',
                t('auto.components.agentConfig.mcp.headers', 'Headers'),
                <AgentConfigPairsField
                  label={t('auto.components.agentConfig.mcp.headers', 'Headers')}
                  pairs={form.headers}
                  keyPlaceholder="Authorization"
                  valuePlaceholder="Bearer …"
                  onChange={(headers) => set({ headers })}
                />
              )}
            </>
          )}
          {codec.canDisable ? (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="agent-config-mcp-enabled">
                {t('auto.components.agentConfig.mcp.enabled', 'Enabled')}
              </Label>
              <Switch
                id="agent-config-mcp-enabled"
                checked={form.enabled}
                onCheckedChange={(enabled) => set({ enabled })}
              />
            </div>
          ) : null}
          {hidden ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex-1">
                {t(
                  'auto.components.agentConfig.mcp.hidden',
                  'Stored secrets are hidden. Leaving ••••••••  as it is keeps the stored value.'
                )}
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={revealing}
                onClick={() => void reveal()}
              >
                {revealing ? <Loader2 className="animate-spin" /> : <Eye />}
                {t('auto.components.agentConfig.mcp.reveal', 'Show')}
              </Button>
            </div>
          ) : null}
          {server && server.extraKeys.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'auto.components.agentConfig.mcp.extraKeys',
                'Also set in the file and kept as written: {{keys}}',
                { keys: server.extraKeys.join(', ') }
              )}
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {form.name === '' && !server ? '' : (problems[0] ?? '')}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('auto.components.agentConfig.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || problems.length > 0}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            {t('auto.components.agentConfig.mcp.save', 'Save server')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
