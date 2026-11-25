import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import type { Connector } from '../../../../../shared/seal-connectors/seal-connectors-types'
import { connectorsCall } from './use-seal-connectors'

// Literal examples of what to type; they are not words to translate.
const HEADERS_PLACEHOLDER = 'Authorization: Bearer …'
const ENV_PLACEHOLDER = 'API_KEY=…'

function parsePairs(text: string, separator: ':' | '='): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf(separator)
    const name = at > 0 ? line.slice(0, at).trim() : ''
    if (name) {
      pairs[name] = line.slice(at + 1).trim()
    }
  }
  return pairs
}

/** A key or token for a connector that is not OAuth: headers for a URL, environment variables for a command. */
export function StaticSecretDialog({
  connector,
  signInId,
  onClose,
  onSaved
}: {
  connector: Pick<Connector, 'id' | 'title'>
  signInId: string | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [label, setLabel] = useState('')
  const [headers, setHeaders] = useState('')
  const [env, setEnv] = useState('')
  const [saving, setSaving] = useState(false)
  const empty = !headers.trim() && !env.trim()

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await connectorsCall('seal.connectors.setStaticSecret', {
        connectorId: connector.id,
        signInId,
        label: label.trim(),
        headers: parsePairs(headers, ':'),
        env: parsePairs(env, '=')
      })
      onSaved()
      onClose()
    } catch (caught) {
      toast.error(t('seal.connectors.static.failed', 'Could not save the key'), {
        description: caught instanceof Error ? caught.message : String(caught)
      })
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-slot="connector-static-secret">
        <DialogHeader>
          <DialogTitle>
            {t('seal.connectors.static.title', 'Key for {{title}}', { title: connector.title })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'seal.connectors.static.description',
              'Stored encrypted on each machine and sent only to this connector. It is never written to a config file.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="connector-static-label">
              {t('seal.connectors.static.label', 'Name (optional)')}
            </Label>
            <Input
              id="connector-static-label"
              value={label}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="connector-static-headers">
              {t('seal.connectors.static.headers', 'Headers, one per line')}
            </Label>
            <Textarea
              id="connector-static-headers"
              rows={3}
              value={headers}
              spellCheck={false}
              placeholder={HEADERS_PLACEHOLDER}
              variant="code"
              onChange={(event) => setHeaders(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="connector-static-env">
              {t('seal.connectors.static.env', 'Environment variables, one per line')}
            </Label>
            <Textarea
              id="connector-static-env"
              rows={3}
              value={env}
              spellCheck={false}
              placeholder={ENV_PLACEHOLDER}
              variant="code"
              onChange={(event) => setEnv(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('seal.accounts.cancel', 'Cancel')}
          </Button>
          <Button disabled={empty || saving} onClick={() => void save()}>
            {t('seal.connectors.static.save', 'Save key')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
