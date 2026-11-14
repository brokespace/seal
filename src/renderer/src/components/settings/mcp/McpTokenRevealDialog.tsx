import { useTranslate } from '@/i18n/use-translate'
import type {
  SealMcpClientCreated,
  SealMcpStatus
} from '../../../../../shared/seal-mcp/seal-mcp-types'
import { Button } from '../../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { McpConnectClient } from './McpConnectClient'
import { McpCopyButton } from './McpCopyButton'

/**
 * The one showing of a new client's token. The owner holds `created` only while this is open and
 * drops it in `onClose`; nothing here stores or logs the token.
 */
export function McpTokenRevealDialog({
  created,
  status,
  environment,
  onClose
}: {
  created: SealMcpClientCreated | null
  status: SealMcpStatus
  environment: string | null
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Dialog
      open={created !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      {created ? (
        <DialogContent
          surface="security"
          scrollable
          className="sm:max-w-2xl"
          // A stray click outside must not throw away a token that cannot be shown again.
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {t('seal.mcp.token.title', 'Token for {{name}}', { name: created.client.name })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'seal.mcp.token.description',
                'This is the only time the token is shown. Seal stores only its hash, so copy it now. If it is lost, revoke this client and add a new one.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 items-center gap-2">
            <code
              data-seal-mcp-token=""
              className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 font-mono text-xs break-all text-foreground select-all"
            >
              {created.token}
            </code>
            <McpCopyButton text={created.token} label={t('seal.mcp.token.copy', 'Copy token')} />
          </div>
          <div className="grid min-w-0 gap-2">
            <p className="text-sm font-semibold">
              {t('seal.mcp.token.setup', 'Set up the client')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                'seal.mcp.token.setupDescription',
                'These already contain the token. Treat anything you paste them into as a secret.'
              )}
            </p>
            <McpConnectClient
              status={status}
              environment={environment}
              token={created.token}
              relayAllowed={created.client.allowRelay}
            />
          </div>
          <DialogFooter>
            <Button onClick={onClose}>{t('seal.mcp.token.done', 'Done')}</Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
