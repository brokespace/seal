import { useTranslate } from '@/i18n/use-translate'
import type { SessionRecapView } from '../../../../shared/session-recap/session-recap-types'
import { recapFailureNote, recapStateNote } from './session-recap-copy'
import type { SessionRecapFailure } from './use-session-recap'

const NOTE = 'border-b border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground'

/** Above the recap: what the user asked that got no answer, and why the recap is not fresh. */
export function SessionRecapNotes({
  view,
  failed,
  server,
  onOpenSettings
}: {
  view: SessionRecapView | null
  failed: SessionRecapFailure | null
  /** The Seal server that keeps the recap; its settings are not this computer's. */
  server: string | null
  onOpenSettings?: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const note = view ? recapStateNote(view, t, server) : null
  return (
    <>
      {failed ? (
        <p role="alert" data-recap-failed={failed} className={NOTE}>
          {recapFailureNote(failed, t)}
        </p>
      ) : null}
      {note ? (
        <p data-recap-note={view?.state} className={NOTE}>
          {note}
          {view?.state === 'unavailable' && !server && onOpenSettings ? (
            <>
              {' '}
              <button
                type="button"
                data-recap-open-settings=""
                onClick={onOpenSettings}
                className="cursor-pointer rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('seal.sessionRecap.openSettings', 'Open settings')}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  )
}
