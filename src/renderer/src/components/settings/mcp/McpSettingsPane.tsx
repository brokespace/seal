import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import {
  useSealMcpApprovals,
  useStableSealMcpTarget
} from '@/components/seal-mcp/use-seal-mcp-approvals'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type {
  SealMcpClient,
  SealMcpClientCreated
} from '../../../../../shared/seal-mcp/seal-mcp-types'
import { McpAuditLog } from './McpAuditLog'
import { McpClientCreateDialog } from './McpClientCreateDialog'
import { McpSettingsView, type McpSettingsActions } from './McpSettingsView'
import { McpTokenRevealDialog } from './McpTokenRevealDialog'
import { useSealMcp } from './use-seal-mcp'

/** Settings → MCP for the Seal server these settings target. The owner keys it by server. */
export function McpSettingsPane({ target }: { target: RuntimeClientTarget }): React.JSX.Element {
  const t = useTranslate()
  const confirm = useConfirmationDialog()
  const stable = useStableSealMcpTarget(target)
  const environmentId = stable.kind === 'environment' ? stable.environmentId : null
  const hostName = useAppStore((s) =>
    environmentId
      ? (s.runtimeEnvironments.find((environment) => environment.id === environmentId)?.name ??
        environmentId)
      : null
  )
  const mcp = useSealMcp(stable)
  const { approvals, answering, respond } = useSealMcpApprovals(stable)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  // Why component state: the token must not outlive the dialog that shows it, in any store or log.
  const [created, setCreated] = useState<SealMcpClientCreated | null>(null)

  const { loadMachines } = mcp
  const ready = mcp.load.phase === 'ready'
  useEffect(() => {
    if (ready) {
      loadMachines()
    }
  }, [loadMachines, ready])

  const confirmThenRun = async (
    client: SealMcpClient,
    kind: 'revoke' | 'remove'
  ): Promise<void> => {
    const confirmed = await confirm(
      kind === 'revoke'
        ? {
            title: t('seal.mcp.clients.revokeTitle', 'Revoke {{name}}?', { name: client.name }),
            description: t(
              'seal.mcp.clients.revokeDescription',
              'Its token stops working at once and cannot be turned back on. The client stays in the list so its past calls keep a name.'
            ),
            confirmLabel: t('seal.mcp.clients.revoke', 'Revoke'),
            confirmVariant: 'destructive',
            surface: 'security'
          }
        : {
            title: t('seal.mcp.clients.removeTitle', 'Remove {{name}}?', { name: client.name }),
            description: t(
              'seal.mcp.clients.removeDescription',
              'Its token stops working at once and the client leaves this list. Its entries stay in the audit log.'
            ),
            confirmLabel: t('seal.mcp.clients.removeConfirm', 'Remove'),
            confirmVariant: 'destructive',
            surface: 'security'
          }
    )
    if (!confirmed) {
      return
    }
    await (kind === 'revoke'
      ? mcp.revokeClient(
          client.id,
          t('seal.mcp.clients.revokeFailed', 'Could not revoke the client')
        )
      : mcp.removeClient(
          client.id,
          t('seal.mcp.clients.removeFailed', 'Could not remove the client')
        ))
  }

  const actions: McpSettingsActions = {
    retry: mcp.retry,
    updateSettings: (patch) => {
      setBusy(true)
      void mcp
        .updateSettings(
          patch,
          t('seal.mcp.endpoints.updateFailed', 'Could not change the endpoint')
        )
        .finally(() => setBusy(false))
    },
    addClient: () => {
      loadMachines()
      setAdding(true)
    },
    revokeClient: (client) => void confirmThenRun(client, 'revoke'),
    removeClient: (client) => void confirmThenRun(client, 'remove'),
    respondApproval: respond
  }

  return (
    <>
      <McpSettingsView
        hostName={hostName}
        environment={environmentId}
        load={mcp.load}
        machines={mcp.machines}
        approvals={approvals}
        answering={answering}
        busy={busy}
        actions={actions}
        audit={
          mcp.load.phase === 'ready' ? (
            <McpAuditLog target={stable} clients={mcp.load.snapshot.clients} />
          ) : null
        }
      />
      <McpClientCreateDialog
        open={adding}
        onOpenChange={setAdding}
        machines={mcp.machines}
        onCreate={async (args) => {
          const result = await mcp.createClient(
            args,
            t('seal.mcp.create.failed', 'Could not add the client')
          )
          if (!result) {
            return false
          }
          setCreated(result)
          return true
        }}
      />
      {mcp.load.phase === 'ready' ? (
        <McpTokenRevealDialog
          created={created}
          status={mcp.load.snapshot.status}
          environment={environmentId}
          onClose={() => setCreated(null)}
        />
      ) : null}
    </>
  )
}
