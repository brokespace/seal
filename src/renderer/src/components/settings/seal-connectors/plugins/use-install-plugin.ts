import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import type { AgentPluginListing } from '../../../../../../shared/agent-plugins/agent-plugin-types'
import { connectorsCall, type SealConnectors } from '../use-seal-connectors'

const INSTALL_TIMEOUT_MS = 5 * 60_000

/** Installs a marketplace plugin into the central list (every machine, account and agent) and tracks what is in flight. */
export function useInstallPlugin(connectors: SealConnectors): {
  installed: ReadonlySet<string>
  installing: ReadonlySet<string>
  run: (name: string, listing: AgentPluginListing) => Promise<boolean>
} {
  const t = useTranslate()
  const [installing, setInstalling] = useState<ReadonlySet<string>>(new Set())
  const installed = useMemo(
    () => new Set((connectors.config?.plugins ?? []).map((plugin) => plugin.name)),
    [connectors.config]
  )
  const { refresh } = connectors
  const run = useCallback(
    async (name: string, listing: AgentPluginListing): Promise<boolean> => {
      setInstalling((current) => new Set(current).add(name))
      let installedOk = false
      try {
        await connectorsCall(
          'seal.connectors.installPlugin',
          { name, marketplace: listing.marketplace, harness: listing.harness },
          { timeoutMs: INSTALL_TIMEOUT_MS }
        )
        await refresh()
        installedOk = true
      } catch (caught) {
        toast.error(t('seal.plugins.installFailed', 'Could not install {{name}}', { name }), {
          description: caught instanceof Error ? caught.message : String(caught)
        })
      }
      setInstalling((current) => {
        const next = new Set(current)
        next.delete(name)
        return next
      })
      return installedOk
    },
    [refresh, t]
  )
  return { installed, installing, run }
}
