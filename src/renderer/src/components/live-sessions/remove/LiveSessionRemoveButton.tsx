import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../../ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { RemoveLiveSessionsDialog } from './RemoveLiveSessionsDialog'

export function LiveSessionRemoveButton({ session }: { session: LiveSession }): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const label = t('auto.components.live-sessions.remove.button', 'Remove from Seal')
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
      </Button>
      <RemoveLiveSessionsDialog sessions={[session]} open={open} onOpenChange={setOpen} />
    </>
  )
}
