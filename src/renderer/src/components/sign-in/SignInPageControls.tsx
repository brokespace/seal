import { useId, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useClipboardTextCopyFeedback } from '@/hooks/clipboard/use-clipboard-text-copy-feedback'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export function SignInCopyButton({
  text,
  label
}: {
  text: string
  label: string
}): React.JSX.Element {
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

/** What the sign-in page handed back (a code or the redirect address), for the CLI to finish with. */
export function SignInPastedCodeForm({
  help,
  onSubmit
}: {
  help?: string
  /** Resolves to a refusal to show, or null once accepted. */
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
        {help ??
          t(
            'seal.accounts.signIn.pasteCodeHelp',
            'If the page shows a code instead of returning here, paste it:'
          )}
      </p>
      <div className="flex items-center gap-2">
        <Input
          autoComplete="off"
          spellCheck={false}
          maxLength={8192}
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
