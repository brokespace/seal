import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'

/** A list of literal entries: permission rules, folders. Each add or remove is one write. */
export function AgentConfigStringListField({
  label,
  items,
  placeholder,
  onChange
}: {
  label: string
  items: readonly string[]
  placeholder: string
  onChange: (items: string[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const next = draft.trim()
    if (next && !items.includes(next)) {
      onChange([...items, next])
    }
    setDraft('')
  }
  return (
    <div className="space-y-1.5">
      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-md bg-muted/40 px-2 py-1 font-mono text-xs">
                {item}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('auto.components.agentConfig.pairs.remove', 'Remove {{name}}', {
                  name: item
                })}
                onClick={() => onChange(items.filter((other) => other !== item))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          aria-label={label}
          variant="code"
          className="h-7 min-w-0 flex-1"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={draft.trim() === ''}
          onClick={add}
        >
          <Plus />
          {t('auto.components.agentConfig.pairs.add', 'Add')}
        </Button>
      </div>
    </div>
  )
}
