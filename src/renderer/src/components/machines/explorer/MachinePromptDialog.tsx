import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslate } from '@/i18n/use-translate'

export type MachinePromptField = {
  id: string
  label: string
  placeholder?: string
  initialValue: string
  /** Returns the problem with the value, or null when it is acceptable. */
  validate: (value: string) => string | null
}

export type MachinePromptRequest = {
  title: string
  description?: string
  confirmLabel: string
  fields: MachinePromptField[]
  onSubmit: (values: string[]) => Promise<void>
}

export function MachinePromptDialog({
  request,
  onClose
}: {
  request: MachinePromptRequest | null
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [values, setValues] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seededFor, setSeededFor] = useState<MachinePromptRequest | null>(null)
  if (seededFor !== request) {
    setSeededFor(request)
    setValues(request?.fields.map((field) => field.initialValue) ?? [])
    setError(null)
    setBusy(false)
  }

  const submit = async (): Promise<void> => {
    if (!request || busy) {
      return
    }
    const trimmed = values.map((value) => value.trim())
    for (const [index, field] of request.fields.entries()) {
      const problem = field.validate(trimmed[index] ?? '')
      if (problem) {
        setError(problem)
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      await request.onSubmit(trimmed)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          {request?.description ? (
            <DialogDescription className="[overflow-wrap:anywhere]">
              {request.description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="space-y-3">
          {request?.fields.map((field, index) => (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id}>{field.label}</Label>
              <Input
                id={field.id}
                autoFocus={index === 0}
                value={values[index] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => {
                  const next = [...values]
                  next[index] = event.target.value
                  setValues(next)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submit()
                  }
                }}
              />
            </div>
          ))}
          {error ? (
            <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('auto.components.machines.prompt.cancel', 'Cancel')}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
