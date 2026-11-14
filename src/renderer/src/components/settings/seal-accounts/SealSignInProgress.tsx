import { useId, useState } from 'react'
import { Check, CircleAlert, Copy, ExternalLink, LoaderCircle } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useClipboardTextCopyFeedback } from '@/hooks/clipboard/use-clipboard-text-copy-feedback'
import {
  isHostAccountSignInPage,
  type HostAccountSignInStatus
} from '../../../../../shared/host-account-sign-in-types'
import type { SealProvider } from '../../../../../shared/seal-accounts/seal-accounts-config'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import type { SealSignInController } from './use-seal-sign-in'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'

function CopyButton({ text, label }: { text: string; label: string }): React.JSX.Element {
  const t = useTranslate()
  const { copyText, status } = useClipboardTextCopyFeedback(text)
  return (
    <Button variant="outline" size="xs" onClick={() => void copyText()}>
      {status === 'copied' ? <Check /> : <Copy />}
      {status === 'copied'
        ? t('seal.accounts.signIn.copied', 'Copied')
        : status === 'failed'
          ? t('seal.accounts.signIn.copyFailed', 'Could not copy')
          : label}
    </Button>
  )
}

function PastedCodeForm({
  onSubmit
}: {
  onSubmit: (code: string) => Promise<string | null>
}): React.JSX.Element {
  const t = useTranslate()
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const helpId = useId()
  const trimmed = code.trim()
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!trimmed || pending) {
          return
        }
        setPending(true)
        void onSubmit(trimmed)
          .then(setRefusal)
          .finally(() => setPending(false))
      }}
    >
      <p id={helpId} className="text-xs text-muted-foreground">
        {t(
          'seal.accounts.signIn.pasteCodeHelp',
          'If the page shows a code instead of returning here, paste it:'
        )}
      </p>
      <div className="flex items-center gap-2">
        <Input
          autoComplete="off"
          spellCheck={false}
          maxLength={2048}
          aria-labelledby={helpId}
          aria-invalid={refusal !== null}
          value={code}
          disabled={pending}
          data-slot="seal-sign-in-code"
          onChange={(event) => {
            setCode(event.target.value)
            setRefusal(null)
          }}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !trimmed}>
          {t('seal.accounts.signIn.submitCode', 'Continue')}
        </Button>
      </div>
      {refusal !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {refusal}
        </p>
      ) : null}
    </form>
  )
}

function Line({
  icon,
  children
}: {
  icon: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <p role="status" className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}

const spinner = (
  <LoaderCircle className="animate-spin text-muted-foreground motion-reduce:animate-none" />
)

type SealSignInProgressProps = {
  provider: SealProvider
  signIn: SealSignInController
  /** Whether Seal asked the CLI to open the browser itself. */
  opensBrowser: boolean
  onRetry: () => void
  onBack: () => void
  onDone: () => void
}

/** One sign-in from start to finish: the page to open, the code to paste, and how it ended. */
export function SealSignInProgress({
  provider,
  signIn,
  opensBrowser,
  onRetry,
  onBack,
  onDone
}: SealSignInProgressProps): React.JSX.Element {
  const t = useTranslate()
  const status: HostAccountSignInStatus | null = signIn.status
  const cli = provider === 'claude' ? 'claude' : 'codex'
  const phase = signIn.error ? 'failed' : (status?.phase ?? 'starting')
  const prompt = status?.phase === 'waiting' ? status.prompt : undefined
  const url = prompt && isHostAccountSignInPage(provider, prompt.url) ? prompt.url : null
  const running = phase === 'starting' || phase === 'waiting' || phase === 'verifying'

  return (
    <div className="space-y-3" data-slot="seal-sign-in" data-phase={phase}>
      {phase === 'starting' ? (
        <Line icon={spinner}>
          {t('seal.accounts.signIn.starting', 'Starting `{{value0}}` sign-in…', { value0: cli })}
        </Line>
      ) : null}
      {phase === 'waiting' ? (
        <Line icon={spinner}>
          {prompt?.userCode
            ? t(
                'seal.accounts.signIn.waitingDevice',
                'Open the page below on any device and enter the code. Seal finishes as soon as you approve.'
              )
            : opensBrowser
              ? t(
                  'seal.accounts.signIn.waitingBrowser',
                  'Finish signing in in the browser window that just opened. Seal continues on its own.'
                )
              : t(
                  'seal.accounts.signIn.waitingLink',
                  'Open the page below, sign in, and Seal continues on its own.'
                )}
        </Line>
      ) : null}
      {phase === 'verifying' ? (
        <Line icon={spinner}>{t('seal.accounts.signIn.verifying', 'Finishing sign-in…')}</Line>
      ) : null}
      {url ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono text-2xs text-foreground/80">
            {url}
          </span>
          <CopyButton text={url} label={t('seal.accounts.signIn.copyLink', 'Copy link')} />
          <Button
            variant="outline"
            size="xs"
            onClick={() => openAppHttpLink(url, { destination: 'system' })}
          >
            <ExternalLink />
            {t('seal.accounts.signIn.open', 'Open page')}
          </Button>
        </div>
      ) : null}
      {url && prompt?.userCode ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('seal.accounts.signIn.enterCode', 'Code to enter on that page:')}
          </span>
          <span
            className="rounded bg-muted px-1.5 py-1 font-mono text-sm text-foreground"
            data-slot="seal-sign-in-user-code"
          >
            {prompt.userCode}
          </span>
          <CopyButton
            text={prompt.userCode}
            label={t('seal.accounts.signIn.copyCode', 'Copy code')}
          />
        </div>
      ) : null}
      {url && status && prompt?.needsCode ? (
        <PastedCodeForm key={status.flowId} onSubmit={signIn.submitCode} />
      ) : null}
      {phase === 'signedIn' && status?.seal ? (
        <>
          <Line icon={<Check className="text-status-success" />}>
            {status.seal.outcome === 'added'
              ? t('seal.accounts.signIn.added', 'Added {{value0}}.', { value0: status.seal.label })
              : t(
                  'seal.accounts.signIn.refreshed',
                  '{{value0}} is signed in again. Its sessions pick up the new login.',
                  { value0: status.seal.label }
                )}
          </Line>
          {status.seal.expected ? (
            <p className="text-xs text-status-warning-text">
              {t(
                'seal.accounts.signIn.otherAccount',
                'You signed in as {{value0}}, not {{value1}}. {{value1}} still needs its own sign-in.',
                { value0: status.seal.label, value1: status.seal.expected }
              )}
            </p>
          ) : null}
        </>
      ) : null}
      {phase === 'failed' ? (
        <Line icon={<CircleAlert className="text-destructive" />}>
          <span className="break-words text-destructive">
            {signIn.error ??
              status?.error ??
              t('seal.accounts.signIn.failed', 'The sign-in did not finish.')}
          </span>
        </Line>
      ) : null}
      {phase === 'cancelled' ? (
        <Line icon={<CircleAlert className="text-muted-foreground" />}>
          {t('seal.accounts.signIn.cancelled', 'Sign-in cancelled. Nothing was added.')}
        </Line>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        {running ? (
          <Button variant="ghost" size="sm" onClick={signIn.cancel} data-slot="seal-sign-in-cancel">
            {t('seal.accounts.signIn.cancel', 'Cancel sign-in')}
          </Button>
        ) : phase === 'signedIn' ? (
          <>
            <Button variant="ghost" size="sm" onClick={onBack}>
              {t('seal.accounts.signIn.addAnother', 'Add another')}
            </Button>
            <Button size="sm" onClick={onDone} data-slot="seal-sign-in-done">
              {t('seal.accounts.done', 'Done')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onBack}>
              {t('seal.accounts.back', 'Back')}
            </Button>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('seal.accounts.signIn.retry', 'Try again')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
