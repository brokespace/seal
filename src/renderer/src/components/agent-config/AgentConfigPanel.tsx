import React, { useCallback, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  agentConfigLayout,
  isAgentConfigAgentId
} from '../../../../shared/agent-config/agent-config-catalog'
import { agentConfigMcpScopes } from '../../../../shared/agent-config/agent-config-mcp-scopes'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import { AgentConfigDocumentsSection } from './documents/AgentConfigDocumentsSection'
import { AgentConfigEffectiveSection } from './settings/AgentConfigEffectiveSection'
import { AgentConfigFilesSection } from './files/AgentConfigFilesSection'
import { AgentConfigMcpSection } from './mcp/AgentConfigMcpSection'
import { AgentConfigPluginsSection } from './plugins/AgentConfigPluginsSection'
import { AgentConfigSettingsSection } from './settings/AgentConfigSettingsSection'
import { agentConfigErrorText } from './model/agent-config-client'
import {
  AgentConfigProvider,
  type AgentConfigCopyProject,
  type AgentConfigPanelState
} from './model/agent-config-context'
import { useAgentConfigSnapshot } from './model/use-agent-config-snapshot'

type TabId = 'documents' | 'mcp' | 'plugins' | 'settings' | 'effective' | 'files'

/** Everything Seal manages for one agent on one machine, or for one project on it. */
export function AgentConfigPanel({
  machine,
  machines,
  projects,
  projectPath
}: {
  machine: MachineSummary
  machines: readonly MachineSummary[]
  projects: readonly AgentConfigCopyProject[]
  projectPath?: string
}): React.JSX.Element {
  const t = useTranslate()
  const online = machine.status === 'online'
  const state = useAgentConfigSnapshot(machine.id, online, projectPath)
  const { agent, agents, snapshot, reload } = state
  const [tab, setTab] = useState<TabId>('documents')
  const layout = agentConfigLayout(agent)

  const apply = useCallback<AgentConfigPanelState['apply']>(
    async (work, done) => {
      try {
        const result = await work()
        if (done) {
          toast.success(done)
        }
        reload()
        return result
      } catch (error) {
        toast.error(agentConfigErrorText(error))
        reload()
        return undefined
      }
    },
    [reload]
  )

  // One object for as long as the place is the same: a reload must not look like a new place.
  const target = useMemo<AgentConfigPanelState['target']>(
    () => ({ machineId: machine.id, agent, ...(projectPath ? { projectPath } : {}) }),
    [agent, machine.id, projectPath]
  )
  const context = useMemo<AgentConfigPanelState | null>(
    () =>
      snapshot
        ? {
            machine,
            machines,
            projects,
            target,
            layout,
            snapshot,
            homeScope: projectPath ? 'project' : 'user',
            reload,
            apply
          }
        : null,
    [apply, layout, machine, machines, projectPath, projects, reload, snapshot, target]
  )

  if (!online) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        {machine.status === 'connecting'
          ? t('auto.components.agentConfig.connecting', 'Connecting to {{machine}}…', {
              machine: machine.label
            })
          : t(
              'auto.components.agentConfig.offline',
              'Connect to {{machine}} to manage agent configuration on it.',
              { machine: machine.label }
            )}
      </p>
    )
  }

  const tabs: { id: TabId; label: string; count?: number }[] = [
    {
      id: 'documents',
      label: t('auto.components.agentConfig.tabs.documents', 'Instructions & skills'),
      count: snapshot?.docs.length
    },
    ...(agentConfigMcpScopes(layout, Boolean(projectPath)).length > 0
      ? [
          {
            id: 'mcp' as const,
            label: t('auto.components.agentConfig.tabs.mcp', 'MCP servers'),
            count: snapshot?.mcp.length
          }
        ]
      : []),
    ...(layout.features.plugins
      ? [
          {
            id: 'plugins' as const,
            label: t('auto.components.agentConfig.tabs.plugins', 'Plugins'),
            count: snapshot?.plugins?.plugins.length
          }
        ]
      : []),
    { id: 'settings', label: t('auto.components.agentConfig.tabs.settings', 'Settings') },
    { id: 'effective', label: t('auto.components.agentConfig.tabs.effective', 'Merged view') },
    { id: 'files', label: t('auto.components.agentConfig.tabs.files', 'Files & backups') }
  ]
  const activeTab = tabs.some((item) => item.id === tab) ? tab : 'documents'

  return (
    <div className="space-y-4" data-agent-config-panel={agent}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={agent}
          onValueChange={(value) => isAgentConfigAgentId(value) && state.setAgent(value)}
        >
          <SelectTrigger
            className="w-48"
            aria-label={t('auto.components.agentConfig.agent', 'Agent')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(agents.length > 0
              ? agents
              : [{ agent, label: layout.label, installed: true, configured: true }]
            ).map((item) => (
              <SelectItem key={item.agent} value={item.agent}>
                {item.label}
                {item.installed || item.configured ? null : (
                  <span className="ml-1 text-muted-foreground">
                    {t('auto.components.agentConfig.notInstalled', '(not installed)')}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          title={snapshot?.agentDir}
        >
          {snapshot?.agentDir ?? ''}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('auto.components.agentConfig.reload', 'Reload from the machine')}
          disabled={state.loading}
          onClick={reload}
        >
          {state.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>

      {state.error ? (
        <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {state.error}
        </p>
      ) : null}
      {snapshot?.warnings.map((warning) => (
        <p key={warning} className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {warning}
        </p>
      ))}
      {snapshot && !snapshot.cliAvailable ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'auto.components.agentConfig.cliMissing',
            '{{agent}} is not on this machine’s PATH. Its files can still be edited here.',
            { agent: layout.label }
          )}
        </p>
      ) : null}

      {context ? (
        <AgentConfigProvider value={context}>
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setTab(tabs.find((item) => item.id === value)?.id ?? 'documents')
            }
          >
            <TabsList size="sm" className="max-w-full flex-wrap justify-start">
              {tabs.map((item) => (
                <TabsTrigger key={item.id} value={item.id} data-agent-config-tab={item.id}>
                  {item.label}
                  {item.count ? (
                    <span className="ml-1 text-2xs text-muted-foreground">{item.count}</span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="documents" className="mt-2">
              <AgentConfigDocumentsSection />
            </TabsContent>
            <TabsContent value="mcp" className="mt-2">
              <AgentConfigMcpSection />
            </TabsContent>
            <TabsContent value="plugins" className="mt-2">
              <AgentConfigPluginsSection />
            </TabsContent>
            <TabsContent value="settings" className="mt-2">
              <AgentConfigSettingsSection />
            </TabsContent>
            <TabsContent value="effective" className="mt-2">
              <AgentConfigEffectiveSection />
            </TabsContent>
            <TabsContent value="files" className="mt-2">
              <AgentConfigFilesSection />
            </TabsContent>
          </Tabs>
        </AgentConfigProvider>
      ) : state.error ? null : (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
