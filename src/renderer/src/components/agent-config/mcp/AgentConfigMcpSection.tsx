import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { agentConfigMcpScopes } from '../../../../../shared/agent-config/agent-config-mcp-scopes'
import type { AgentConfigMcpServer } from '../../../../../shared/agent-config/agent-config-types'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import {
  AgentConfigConfirmDialog,
  type AgentConfigConfirmRequest
} from '../AgentConfigConfirmDialog'
import { AgentConfigCopyDialog, type AgentConfigCopyRequest } from '../AgentConfigCopyDialog'
import { agentConfigApi, agentConfigErrorText } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'
import { agentConfigScopeHint, agentConfigScopeLabel } from '../model/agent-config-scope-labels'
import { AgentConfigMcpRow, type AgentConfigMcpTestState } from './AgentConfigMcpRow'
import { AgentConfigMcpSheet, type AgentConfigMcpEdit } from './AgentConfigMcpSheet'

function serverKey(server: AgentConfigMcpServer): string {
  return `${server.scope}:${server.name}`
}

export function AgentConfigMcpSection(): React.JSX.Element {
  const t = useTranslate()
  const { layout, snapshot, target, machine, apply, reload } = useAgentConfig()
  const [edit, setEdit] = useState<AgentConfigMcpEdit | null>(null)
  const [confirm, setConfirm] = useState<AgentConfigConfirmRequest | null>(null)
  const [copy, setCopy] = useState<AgentConfigCopyRequest | null>(null)
  const [tests, setTests] = useState<ReadonlyMap<string, AgentConfigMcpTestState>>(new Map())
  const scopes = agentConfigMcpScopes(layout, Boolean(target.projectPath))

  const runTest = (server: AgentConfigMcpServer): void => {
    const key = serverKey(server)
    setTests((previous) => new Map(previous).set(key, 'testing'))
    void Promise.resolve()
      .then(() =>
        agentConfigApi().testMcpServer({ target, scope: server.scope, name: server.name })
      )
      .catch((failure: unknown) => ({
        status: 'failed' as const,
        auth: 'unknown' as const,
        detail: agentConfigErrorText(failure),
        durationMs: 0
      }))
      .then((result) => setTests((previous) => new Map(previous).set(key, result)))
  }

  return (
    <div className="space-y-6" data-agent-config-section="mcp">
      {scopes.map(({ scope, file }) => {
        const servers = snapshot.mcp.filter((server) => server.scope === scope)
        return (
          <SettingsGroup
            key={scope}
            title={t('auto.components.agentConfig.mcp.groupTitle', '{{scope}} servers', {
              scope: agentConfigScopeLabel(scope, t)
            })}
            description={
              <>
                {agentConfigScopeHint(scope, t)} <span className="font-mono">{file}</span>
              </>
            }
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-agent-config-mcp-add={scope}
                onClick={() => setEdit({ server: null, scope })}
              >
                <Plus />
                {t('auto.components.agentConfig.mcp.add', 'Add server')}
              </Button>
            }
          >
            {servers.length === 0 ? (
              <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
                {t('auto.components.agentConfig.mcp.empty', 'No servers here.')}
              </p>
            ) : (
              servers.map((server) => (
                <AgentConfigMcpRow
                  key={serverKey(server)}
                  server={server}
                  test={tests.get(serverKey(server))}
                  onTest={() => runTest(server)}
                  onEdit={() => setEdit({ server, scope })}
                  onCopy={() => setCopy({ type: 'mcp', server })}
                  onActivation={(activation) =>
                    void apply(() =>
                      agentConfigApi().setMcpActivation({ target, name: server.name, activation })
                    )
                  }
                  onRemove={() =>
                    setConfirm({
                      title: t('auto.components.agentConfig.mcp.removeTitle', 'Remove {{name}}?', {
                        name: server.name
                      }),
                      description: t(
                        'auto.components.agentConfig.mcp.removeDescription',
                        'The server is taken out of {{path}} on {{machine}}. The file as it is now is kept in backups.',
                        { path: server.sourcePath, machine: machine.label }
                      ),
                      confirmLabel: t('auto.components.agentConfig.mcp.removeConfirm', 'Remove'),
                      destructive: true,
                      run: async () => {
                        await agentConfigApi().removeMcpServer({
                          target,
                          scope: server.scope,
                          name: server.name
                        })
                        reload()
                      }
                    })
                  }
                />
              ))
            )}
          </SettingsGroup>
        )
      })}
      <AgentConfigMcpSheet edit={edit} onClose={() => setEdit(null)} />
      <AgentConfigConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <AgentConfigCopyDialog request={copy} onClose={() => setCopy(null)} />
    </div>
  )
}
