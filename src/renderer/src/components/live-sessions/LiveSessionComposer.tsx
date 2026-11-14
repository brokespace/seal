import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'

/** Plain text in, one message out: delivery is tracked by the outbox, so the field clears on send. */
export function LiveSessionComposer({
  onSend,
  unavailableHint,
  focusSignal
}: {
  onSend: (text: string) => void
  /** Set when nothing can reach the session; the field is disabled and says why. */
  unavailableHint: string | null
  /** Changes when something outside asks to type here. */
  focusSignal?: number
}): React.JSX.Element {
  const t = useTranslate()
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focusSignal) {
      field.current?.focus()
    }
  }, [focusSignal])
  const submit = () => {
    const text = draft.trim()
    if (!text || unavailableHint) {
      return
    }
    onSend(text)
    setDraft('')
  }
  return (
    <div className="mx-auto flex w-full max-w-(--chat-content-max-width) items-end gap-2 px-3 pt-2 pb-3 sm:px-4">
      <Textarea
        ref={field}
        value={draft}
        disabled={unavailableHint !== null}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        rows={2}
        placeholder={
          unavailableHint ??
          t('auto.components.live-sessions.LiveSessionComposer.placeholder', 'Message this session')
        }
        className="max-h-48 min-h-10 resize-none"
      />
      <Button
        type="button"
        size="icon"
        onClick={submit}
        disabled={!draft.trim() || unavailableHint !== null}
        aria-label={t('auto.components.live-sessions.LiveSessionComposer.send', 'Send')}
      >
        <ArrowUp className="size-4" />
      </Button>
    </div>
  )
}
