import { useState } from 'react'
import { ListChecks, Trash2 } from 'lucide-react'
import { Button } from '../../ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import {
  RemoveLiveSessionsDialog,
  type RemoveLiveSessionsDialogProps
} from './RemoveLiveSessionsDialog'

/** The page header's Select mode: pick sessions in the list, then remove them together. */
export function LiveSessionBulkActions({
  sessions,
  checked,
  onCheckedChange,
  remove,
  initiallyConfirming = false
}: {
  sessions: readonly LiveSession[]
  checked: ReadonlySet<string> | null
  onCheckedChange: (checked: ReadonlySet<string> | null) => void
  remove?: RemoveLiveSessionsDialogProps['remove']
  initiallyConfirming?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const [confirming, setConfirming] = useState(initiallyConfirming)
  if (sessions.length === 0) {
    return null
  }
  if (!checked) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => onCheckedChange(new Set())}>
        <ListChecks className="size-4" />
        {t('auto.components.live-sessions.remove.select', 'Select')}
      </Button>
    )
  }
  const picked = sessions.filter((s) => checked.has(s.id))
  const allPicked = picked.length === sessions.length
  return (
    <>
      <span className="text-xs text-muted-foreground tabular-nums">
        {t('auto.components.live-sessions.remove.selected', '{{count}} selected', {
          count: picked.length
        })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onCheckedChange(new Set(allPicked ? [] : sessions.map((s) => s.id)))}
      >
        {allPicked
          ? t('auto.components.live-sessions.remove.selectNone', 'Select none')
          : t('auto.components.live-sessions.remove.selectAll', 'Select all')}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={picked.length === 0}
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-4" />
        {t('auto.components.live-sessions.remove.removeSelected', 'Remove')}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => onCheckedChange(null)}>
        {t('auto.components.live-sessions.remove.done', 'Done')}
      </Button>
      <RemoveLiveSessionsDialog
        sessions={picked}
        open={confirming && picked.length > 0}
        onOpenChange={setConfirming}
        onRemoved={() => onCheckedChange(null)}
        remove={remove}
      />
    </>
  )
}
