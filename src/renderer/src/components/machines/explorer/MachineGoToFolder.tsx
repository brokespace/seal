import React, { useEffect, useId, useRef, useState } from 'react'
import { CornerDownLeft, Folder, History } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { MENU_SURFACE_CLASS } from '@/components/ui/menu-surface'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'
import type { MachineFolderCompletion } from '../../../../../shared/machines/machine-resource-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { completedFolderInput, folderMatchesFor, sharedFolderInput } from './machine-folder-typing'

const COMPLETE_DELAY_MS = 80

type Option = { path: string; label: string }

/** Type a path, Tab to complete it, Enter to open the tree there. Empty, it offers recent folders. */
export function MachineGoToFolder({
  machineId,
  currentDir,
  homeDir,
  onOpen
}: {
  machineId: MachineId
  currentDir: string | null
  homeDir: string | null
  onOpen: (path: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [completion, setCompletion] = useState<{
    for: string
    found: MachineFolderCompletion
  } | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const [active, setActive] = useState(-1)
  const [error, setError] = useState<string | null>(null)

  const typing = value.trim() !== ''
  useEffect(() => {
    if (!focused || !typing) {
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.machines
        ?.completeFolder({ machineId, input: value, ...(currentDir ? { currentDir } : {}) })
        .then((found) => {
          if (!cancelled) {
            setCompletion({ for: value, found })
          }
        })
        // A folder that cannot be listed simply has nothing to suggest.
        .catch(() => !cancelled && setCompletion(null))
    }, COMPLETE_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [machineId, currentDir, value, focused, typing])

  const matches = typing
    ? folderMatchesFor(
        value,
        completion ? { for: completion.for, matches: completion.found.matches } : null
      )
    : []
  const options: Option[] = typing
    ? matches.map((match) => ({ path: match.path, label: match.name }))
    : recents.map((path) => ({ path, label: path }))
  const listOpen = focused && !dismissed && options.length > 0

  const edit = (next: string): void => {
    setValue(next)
    setActive(-1)
    setDismissed(false)
    setError(null)
  }

  const open = async (input: string): Promise<void> => {
    const api = window.api.machines
    if (!api || input.trim() === '') {
      return
    }
    try {
      const result = await api.openFolder({
        machineId,
        input,
        ...(currentDir ? { currentDir } : {})
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      onOpen(result.path)
      edit('')
      setCompletion(null)
      inputRef.current?.blur()
    } catch (err) {
      setError(readIpcErrorMessage(err) ?? String(err))
    }
  }

  const complete = (): void => {
    const picked = options[active] ?? (options.length === 1 ? options[0] : undefined)
    if (picked) {
      edit(completedFolderInput(value, picked.path, homeDir))
      return
    }
    const shared = completion
      ? sharedFolderInput(
          value,
          completion.found.parent,
          matches.map((match) => match.name),
          homeDir
        )
      : null
    if (shared) {
      edit(shared)
    } else if (options.length > 0) {
      setActive(0)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) {
        return
      }
      event.preventDefault()
      setDismissed(false)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) =>
        current < 0
          ? step > 0
            ? 0
            : options.length - 1
          : (current + step + options.length) % options.length
      )
    } else if (event.key === 'Tab' && !event.shiftKey && (typing || active >= 0)) {
      event.preventDefault()
      complete()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void open(listOpen && options[active] ? options[active].path : value)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (listOpen) {
        setDismissed(true)
        setActive(-1)
      } else {
        edit('')
        inputRef.current?.blur()
      }
    }
  }

  return (
    <div className="relative shrink-0 border-b border-border px-2 py-1" data-machine-go-to-folder>
      <div className="flex items-center gap-1.5">
        <CornerDownLeft className="size-3 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          density="compact"
          variant="code"
          className="min-w-0 flex-1"
          value={value}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listOpen && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={error !== null}
          aria-label={t('auto.components.machines.goTo.label', 'Go to folder')}
          placeholder={t(
            'auto.components.machines.goTo.placeholder',
            'Go to folder… type a path such as ~/projects, Tab completes'
          )}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true)
            setDismissed(false)
            void window.api.machines
              ?.recentFolders({ machineId })
              .then(setRecents)
              .catch(() => {})
          }}
          onBlur={() => {
            setFocused(false)
            setActive(-1)
          }}
        />
      </div>
      {error ? (
        <p className="pt-1 text-2xs text-destructive [overflow-wrap:anywhere]" role="alert">
          {error}
        </p>
      ) : null}
      {listOpen ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={
            typing
              ? t('auto.components.machines.goTo.matches', 'Matching folders')
              : t('auto.components.machines.goTo.recent', 'Recent folders')
          }
          className={cn(
            MENU_SURFACE_CLASS,
            'scrollbar-sleek absolute top-full right-2 left-2 z-30 mt-1 max-h-64 overflow-y-auto'
          )}
        >
          {typing ? null : (
            <li role="presentation" className="px-2 pb-1 text-3xs text-muted-foreground uppercase">
              {t('auto.components.machines.goTo.recent', 'Recent folders')}
            </li>
          )}
          {options.map((option, index) => (
            <li
              key={option.path}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                'flex cursor-default items-center gap-2 rounded-md px-2 py-1 font-mono text-xs',
                index === active && 'bg-accent text-accent-foreground'
              )}
              // Keep focus in the input so the list survives the press.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => void open(option.path)}
            >
              {typing ? (
                <Folder className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <History className="size-3 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 truncate">{option.label}</span>
              {typing ? (
                <span className="min-w-0 flex-1 truncate text-right text-2xs text-muted-foreground">
                  {option.path}
                </span>
              ) : null}
            </li>
          ))}
          {typing && completion?.found.truncated ? (
            <li role="presentation" className="px-2 pt-1 text-2xs text-muted-foreground">
              {t(
                'auto.components.machines.goTo.more',
                'More folders match. Keep typing to narrow.'
              )}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
