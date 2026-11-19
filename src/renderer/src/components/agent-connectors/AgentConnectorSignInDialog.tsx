import React, { useEffect, useEffectEvent, useState } from 'react'
import { Check, CircleAlert, ExternalLink, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { LOCAL_MACHINE_ID, type MachineId } from '../../../../shared/machines/machine-types'
import { SignInCopyButton, SignInPastedCodeForm } from '../sign-in/SignInPageControls'
import { agentConnectorsApi, agentConnectorsErrorText } from './use-agent-connectors'

export type AgentConnectorSignInRequest = {
  accountId: string
  accountLabel: string
  name: string
}

type Flow =
  | { phase: 'starting' }
  | { phase: 'waiting'; sessionId: string; url: string }
  | { phase: 'done'; message: string | null }
  | { phase: 'failed'; message: string | null }

const spinner = (
  <LoaderCircle className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
)

/** Runs `mcp login` on the agent's machine and walks the user through the page it prints. */
export function AgentConnectorSignInDialog({
  machineId,
  machineLabel,
  request,
  onClose,
  onSignedIn
}: {
  machineId: MachineId
  machineLabel: string
  request: AgentConnectorSignInRequest
  onClose: () => void
  onSignedIn: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [flow, setFlow] = useState<Flow>({ phase: 'starting' })
  const [attempt, setAttempt] = useState(0)
  const sameMachine = machineId === LOCAL_MACHINE_ID
  const signedIn = useEffectEvent(onSignedIn)
  const sessionId = flow.phase === 'waiting' ? flow.sessionId : null

  useEffect(() => {
    const api = agentConnectorsApi()
    if (!api) {
      return
    }
    let live = true
    let started: string | null = null
    setFlow({ phase: 'starting' })
    void (async () => {
      try {
        const start = await api.signInStart({
          machineId,
          accountId: request.accountId,
          name: request.name
        })
        let result = start.kind === 'finished' ? start.result : null
        if (start.kind === 'url') {
          started = start.sessionId
          if (!live) {
            void api.signInCancel({ sessionId: start.sessionId })
            return
          }
          setFlow({ phase: 'waiting', sessionId: start.sessionId, url: start.url })
          result = await api.signInWait({ sessionId: start.sessionId })
        }
        if (!live || !result) {
          return
        }
        setFlow(
          result.ok
            ? { phase: 'done', message: result.message }
            : { phase: 'failed', message: result.message }
        )
        if (result.ok) {
          signedIn()
        }
      } catch (caught) {
        if (live) {
          setFlow({ phase: 'failed', message: agentConnectorsErrorText(caught) })
        }
      }
    })()
    return () => {
      live = false
      if (started) {
        void api.signInCancel({ sessionId: started })
      }
    }
  }, [machineId, request.accountId, request.name, attempt])

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg" data-slot="agent-connector-sign-in">
        <DialogHeader>
          <DialogTitle>
            {t('auto.components.agentConnectors.signInTitle', 'Sign in to {{name}}', {
              name: request.name
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'auto.components.agentConnectors.signInDescription',
              'For agents running as {{account}} on {{machine}}.',
              { account: request.accountLabel, machine: machineLabel }
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {flow.phase === 'starting' ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              {spinner}
              {t(
                'auto.components.agentConnectors.starting',
                'Asking the agent for a sign-in page…'
              )}
            </p>
          ) : null}
          {flow.phase === 'waiting' ? (
            <>
              <p role="status" className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0">{spinner}</span>
                <span>
                  {sameMachine
                    ? t(
                        'auto.components.agentConnectors.waitingLocal',
                        'Open the page and approve access. The browser returns to this computer and Seal finishes on its own.'
                      )
                    : t(
                        'auto.components.agentConnectors.waitingRemote',
                        'Open the page and approve access. The browser then lands on a localhost address that will not load, because the agent runs on {{machine}}. Paste that address below.',
                        { machine: machineLabel }
                      )}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono text-2xs text-foreground/80">
                  {flow.url}
                </span>
                <SignInCopyButton
                  text={flow.url}
                  label={t('auto.components.agentConnectors.copyLink', 'Copy link')}
                />
                <Button
                  size="xs"
                  autoFocus
                  onClick={() => openAppHttpLink(flow.url, { destination: 'system' })}
                >
                  <ExternalLink />
                  {t('auto.components.agentConnectors.openInBrowser', 'Open in browser')}
                </Button>
              </div>
              <SignInPastedCodeForm
                help={
                  sameMachine
                    ? t(
                        'auto.components.agentConnectors.pasteLocal',
                        'If the browser shows an error page instead, paste its address here:'
                      )
                    : t(
                        'auto.components.agentConnectors.pasteRemote',
                        'Address the browser ended on:'
                      )
                }
                onSubmit={async (redirectUrl) => {
                  const api = agentConnectorsApi()
                  if (!api || !sessionId) {
                    return null
                  }
                  try {
                    return await api.signInSubmit({ sessionId, redirectUrl })
                  } catch (caught) {
                    return agentConnectorsErrorText(caught)
                  }
                }}
              />
            </>
          ) : null}
          {flow.phase === 'done' ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-status-success" />
              {t(
                'auto.components.agentConnectors.signedIn',
                'Signed in. New agent sessions for this account can use {{name}}.',
                { name: request.name }
              )}
            </p>
          ) : null}
          {flow.phase === 'failed' ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">
                {flow.message ??
                  t('auto.components.agentConnectors.signInFailed', 'The sign-in did not finish.')}
              </span>
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            {flow.phase === 'failed' ? (
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                {t('auto.components.agentConnectors.retry', 'Try again')}
              </Button>
            ) : null}
            {flow.phase === 'done' ? (
              <Button size="sm" onClick={onClose}>
                {t('auto.components.agentConnectors.done', 'Done')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onClose}>
                {flow.phase === 'failed'
                  ? t('auto.components.agentConnectors.close', 'Close')
                  : t('auto.components.agentConnectors.cancel', 'Cancel')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
