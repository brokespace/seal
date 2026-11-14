import { Check, Copy } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useClipboardTextCopyFeedback } from '@/hooks/clipboard/use-clipboard-text-copy-feedback'
import { Button } from '../../ui/button'

/** Copies `text` and says so in its own label; `label` names what is copied. */
export function McpCopyButton({ text, label }: { text: string; label: string }): React.JSX.Element {
  const t = useTranslate()
  const { copyText, status } = useClipboardTextCopyFeedback(text)
  return (
    <Button
      variant="outline"
      size="xs"
      className="shrink-0"
      aria-label={status === 'idle' ? label : undefined}
      onClick={() => void copyText()}
    >
      {status === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
      {status === 'copied'
        ? t('seal.mcp.copy.copied', 'Copied')
        : status === 'failed'
          ? t('seal.mcp.copy.failed', 'Could not copy')
          : t('seal.mcp.copy.copy', 'Copy')}
    </Button>
  )
}
