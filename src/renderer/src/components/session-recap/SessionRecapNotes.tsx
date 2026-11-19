import { useTranslate } from '@/i18n/use-translate'
import { getProviderAccountsOwnerKey } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import {
  LOCAL_USAGE_CREDENTIAL_HOST,
  type UsageCredentialHost
} from '../settings/accounts/usage/usage-credential-host'
import type { SessionRecapView } from '../../../../shared/session-recap/session-recap-types'
import { recapFailureNote, recapStateNote } from './session-recap-copy'
import { SessionRecapSettingsFix } from './SessionRecapSettingsFix'
import type { SessionRecapFailure } from './use-session-recap'

const NOTE = 'border-b border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground'

/** Above the recap: what the user asked that got no answer, and why the recap is not fresh. */
export function SessionRecapNotes({
  view,
  failed,
  host = LOCAL_USAGE_CREDENTIAL_HOST,
  onSettingsChanged
}: {
  view: SessionRecapView | null
  failed: SessionRecapFailure | null
  /** The computer or Seal server that keeps the recap; its settings are not always this one's. */
  host?: UsageCredentialHost
  /** A recap setting was saved on `host`. */
  onSettingsChanged: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const unavailable = view?.state === 'unavailable'
  const note = view && !unavailable ? recapStateNote(view, t, host.label) : null
  return (
    <>
      {failed ? (
        <p role="alert" data-recap-failed={failed} className={NOTE}>
          {recapFailureNote(failed, t)}
        </p>
      ) : null}
      {view && unavailable ? (
        <SessionRecapSettingsFix
          key={getProviderAccountsOwnerKey(host.owner)}
          view={view}
          host={host}
          className={NOTE}
          onChanged={onSettingsChanged}
        />
      ) : note ? (
        <p data-recap-note={view?.state} className={NOTE}>
          {note}
        </p>
      ) : null}
    </>
  )
}
