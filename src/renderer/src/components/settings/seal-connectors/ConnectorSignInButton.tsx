import { useState } from 'react'
import { ExternalLink, KeyRound, LoaderCircle, Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import type { Connector } from '../../../../../shared/seal-connectors/seal-connectors-types'
import { SignInCopyButton, SignInPastedCodeForm } from '../../sign-in/SignInPageControls'
import { StaticSecretDialog } from './StaticSecretDialog'
import { useConnectorSignIn } from './use-connector-sign-in'

/** Connect (or Reconnect) one sign-in of a connector; the same button on the Connectors and Plugins pages. */
export function ConnectorSignInButton({
  connector,
  signInId = null,
  label,
  variant = 'outline',
  onDone
}: {
  connector: Pick<Connector, 'id' | 'title' | 'auth'>
  /** The sign-in to renew; null adds another one. */
  signInId?: string | null
  label?: string
  variant?: 'outline' | 'default' | 'ghost'
  onDone: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const signIn = useConnectorSignIn(connector, onDone)
  const [keyOpen, setKeyOpen] = useState(false)
  if (connector.auth === 'none') {
    return null
  }
  const busy = signIn.phase === 'starting'
  const text =
    label ??
    (signInId
      ? t('seal.connectors.signIn.reconnect', 'Reconnect')
      : t('seal.connectors.signIn.connect', 'Connect'))

  if (connector.auth === 'static') {
    return (
      <>
        <Button variant={variant} size="xs" onClick={() => setKeyOpen(true)}>
          <KeyRound />
          {label ??
            (signInId
              ? t('seal.connectors.signIn.replaceKey', 'Replace key')
              : t('seal.connectors.signIn.addKey', 'Add key'))}
        </Button>
        {keyOpen ? (
          <StaticSecretDialog
            connector={connector}
            signInId={signInId}
            onClose={() => setKeyOpen(false)}
            onSaved={onDone}
          />
        ) : null}
      </>
    )
  }

  return (
    <>
      <Button
        variant={variant}
        size="xs"
        disabled={busy || signIn.phase === 'waiting'}
        onClick={() => signIn.start(signInId)}
        data-connector-connect={connector.id}
      >
        {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Plug />}
        {text}
      </Button>
      <Dialog
        open={signIn.phase === 'waiting' || signIn.phase === 'failed'}
        onOpenChange={(open) => {
          if (!open) {
            if (signIn.phase === 'waiting') {
              signIn.cancel()
            } else {
              signIn.dismiss()
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-slot="connector-sign-in">
          <DialogHeader>
            <DialogTitle>
              {t('seal.connectors.signIn.title', 'Connect {{title}}', { title: connector.title })}
            </DialogTitle>
            <DialogDescription>
              {signIn.phase === 'failed'
                ? t('seal.connectors.signIn.failed', 'The sign-in did not finish.')
                : t(
                    'seal.connectors.signIn.waiting',
                    'Approve access in the browser window that just opened. Seal finishes on its own and copies the sign-in to every machine.'
                  )}
            </DialogDescription>
          </DialogHeader>
          {signIn.phase === 'failed' ? (
            <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
              {signIn.error}
            </p>
          ) : (
            <div className="space-y-3">
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                {t('seal.connectors.signIn.waitingStatus', 'Waiting for approval…')}
              </p>
              {signIn.url ? (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono text-2xs text-foreground/80">
                    {signIn.url}
                  </span>
                  <SignInCopyButton
                    text={signIn.url}
                    label={t('seal.accounts.signIn.copyLink', 'Copy link')}
                  />
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => openAppHttpLink(signIn.url ?? '', { destination: 'system' })}
                  >
                    <ExternalLink />
                    {t('seal.accounts.signIn.open', 'Open page')}
                  </Button>
                </div>
              ) : null}
              <SignInPastedCodeForm
                help={t(
                  'seal.connectors.signIn.pasteHelp',
                  'If the browser ends on a page that cannot load, paste the address it ended on:'
                )}
                onSubmit={signIn.submitRedirect}
              />
            </div>
          )}
          <DialogFooter>
            {signIn.phase === 'failed' ? (
              <>
                <Button variant="ghost" onClick={signIn.dismiss}>
                  {t('seal.accounts.back', 'Back')}
                </Button>
                <Button variant="outline" onClick={() => signIn.start(signInId)}>
                  {t('seal.accounts.signIn.retry', 'Try again')}
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={signIn.cancel}>
                {t('seal.accounts.signIn.cancel', 'Cancel sign-in')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
