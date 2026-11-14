import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import { agentConfigErrorText } from './model/agent-config-client'

export type AgentConfigConfirmRequest = {
  title: string
  description: string
  confirmLabel: string
  /** Removals are destructive; restores and updates are not. */
  destructive?: boolean
  run: () => Promise<void>
}

export function AgentConfigConfirmDialog({
  request,
  onClose
}: {
  request: AgentConfigConfirmRequest | null
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<AgentConfigConfirmRequest | null>(null)
  if (seededFor !== request) {
    setSeededFor(request)
    setBusy(false)
    setError(null)
  }
  const confirm = async (): Promise<void> => {
    if (!request || busy) {
      return
    }
    setBusy(true)
    try {
      await request.run()
      onClose()
    } catch (failure) {
      setError(agentConfigErrorText(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-agent-config-confirm>
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {request?.description}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('auto.components.agentConfig.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant={request?.destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
