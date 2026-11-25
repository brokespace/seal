import React, { useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/class-names'

/** Text that is written when the field is left or Enter is pressed, never per keystroke. */
export function AgentConfigCommitInput({
  id,
  value,
  placeholder,
  ariaLabel,
  className,
  onCommit
}: {
  id?: string
  value: string
  placeholder?: string
  ariaLabel?: string
  className?: string
  onCommit: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [seededFor, setSeededFor] = useState(value)
  if (seededFor !== value) {
    setSeededFor(value)
    setDraft(value)
  }
  const commit = (): void => {
    const next = draft.trim()
    if (next !== value) {
      onCommit(next)
    }
  }
  return (
    <Input
      id={id}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      variant="code"
      className={cn('h-7', className)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          setDraft(value)
        }
      }}
    />
  )
}
