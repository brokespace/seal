import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import type {
  HomeChatMachineNote,
  HomeChatMemoryItem
} from '../../../../shared/home-chat/home-chat-memory-types'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'

function newItem(text: string): HomeChatMemoryItem {
  return { id: createNonSecureContextUuid().slice(0, 8), text, at: Date.now() }
}

/** One memory section: edit, remove or add short items. */
export function HomeChatMemoryItems({
  items,
  placeholder,
  emptyText,
  showDates,
  onChange
}: {
  items: readonly HomeChatMemoryItem[]
  placeholder: string
  emptyText: string
  showDates?: boolean
  onChange: (items: HomeChatMemoryItem[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  const locale = useIntlLocale()
  const [draft, setDraft] = useState('')
  const add = (): void => {
    if (draft.trim()) {
      onChange([...items, newItem(draft.trim())])
      setDraft('')
    }
  }
  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-xs text-muted-foreground">{emptyText}</p>}
      <ul className="scrollbar-sleek max-h-72 space-y-1.5 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            {showDates && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {new Date(item.at).toLocaleDateString(locale)}
              </span>
            )}
            <Input
              value={item.text}
              className="h-8"
              aria-label={item.text}
              onChange={(event) =>
                onChange(
                  items.map((i) => (i.id === item.id ? { ...i, text: event.target.value } : i))
                )
              }
            />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('homeChat.memory.remove', 'Remove')}
              onClick={() => onChange(items.filter((i) => i.id !== item.id))}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          className="h-8"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && add()}
        />
        <Button size="sm" variant="outline" disabled={!draft.trim()} onClick={add}>
          <Plus />
          {t('homeChat.memory.add', 'Add')}
        </Button>
      </div>
    </div>
  )
}

function hopSummary(note: HomeChatMachineNote): string | null {
  if (!note.via) {
    return null
  }
  const target = `${note.user ? `${note.user}@` : ''}${note.host ?? ''}${note.port ? `:${note.port}` : ''}`
  return `${target} via ${note.via}`
}

/** Notes per machine, and the jump-host entries the assistant reaches through other machines. */
export function HomeChatMachineNotes({
  notes,
  onChange
}: {
  notes: readonly HomeChatMachineNote[]
  onChange: (notes: HomeChatMachineNote[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  if (notes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t(
          'homeChat.memory.machinesEmpty',
          'No machine notes yet. The assistant adds them as it learns your machines, or ask it to reach a machine through another one.'
        )}
      </p>
    )
  }
  return (
    <ul className="scrollbar-sleek max-h-80 space-y-3 overflow-y-auto">
      {notes.map((note) => (
        <li key={note.machine} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
              {note.machine}
            </span>
            {hopSummary(note) && (
              <span className="truncate text-xs text-muted-foreground">{hopSummary(note)}</span>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('homeChat.memory.remove', 'Remove')}
              onClick={() => onChange(notes.filter((n) => n.machine !== note.machine))}
            >
              <Trash2 />
            </Button>
          </div>
          <Textarea
            value={note.notes}
            rows={2}
            aria-label={note.machine}
            onChange={(event) =>
              onChange(
                notes.map((n) =>
                  n.machine === note.machine ? { ...n, notes: event.target.value } : n
                )
              )
            }
          />
        </li>
      ))}
    </ul>
  )
}
