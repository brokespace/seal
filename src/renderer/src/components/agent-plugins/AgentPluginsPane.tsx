import React, { useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslate } from '@/i18n/use-translate'
import { useInstallPlugin } from '../settings/seal-connectors/plugins/use-install-plugin'
import {
  useSealConnectors,
  type SealConnectors
} from '../settings/seal-connectors/use-seal-connectors'
import { AgentPluginsBrowse } from './AgentPluginsBrowse'
import { AgentPluginsInstalled } from './AgentPluginsInstalled'

type TabId = 'installed' | 'browse'

export function AgentPluginsPaneView({
  connectors,
  initialTab = 'installed'
}: {
  connectors: SealConnectors
  initialTab?: TabId
}): React.JSX.Element {
  const t = useTranslate()
  const [tab, setTab] = useState<TabId>(initialTab)
  const install = useInstallPlugin(connectors)
  const count = connectors.config?.plugins.length ?? 0

  return (
    <div data-agent-plugins-pane="">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value === 'browse' ? 'browse' : 'installed')}
      >
        <TabsList size="sm">
          <TabsTrigger value="installed" data-agent-plugins-tab="installed">
            {t('seal.plugins.tabs.installed', 'Installed')}
            {count > 0 ? (
              <span className="ml-1 text-2xs text-muted-foreground">{count}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="browse" data-agent-plugins-tab="browse">
            {t('seal.plugins.tabs.browse', 'Browse')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="installed" className="mt-4">
          <div className="space-y-6">
            <AgentPluginsInstalled connectors={connectors} />
          </div>
        </TabsContent>
        <TabsContent value="browse" className="mt-4">
          <AgentPluginsBrowse
            installed={install.installed}
            installing={install.installing}
            onInstall={(entry, listing) =>
              void install.run(entry.name, listing).then((ok) => {
                if (ok) {
                  toast.success(
                    t(
                      'seal.plugins.installed.toast',
                      '{{name}} installed for every machine and account.',
                      {
                        name: entry.name
                      }
                    )
                  )
                  setTab('installed')
                }
              })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** One plugins surface: what is installed, and the marketplaces to install from. */
export function AgentPluginsPane(): React.JSX.Element {
  const t = useTranslate()
  const connectors = useSealConnectors(t('seal.connectors.error', 'Could not update connectors'))
  return <AgentPluginsPaneView connectors={connectors} />
}
