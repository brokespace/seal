import { useEffect, useState } from 'react'
import { Download, FolderOpen, Paperclip, Server } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import { formatHomeChatBytes } from './home-chat-format'

type AttachmentEntry = Extract<HomeChatEntry, { kind: 'attachment' }>

export type HomeChatAttachmentActions = {
  read: (attachmentId: string) => Promise<{ mimeType: string; base64: string }>
  save: (attachmentId: string, name: string) => void
  reveal: (attachmentId: string) => void
}

const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024

function useInlineImage(
  entry: AttachmentEntry,
  read: HomeChatAttachmentActions['read']
): string | null {
  const [src, setSrc] = useState<string | null>(null)
  const inline = entry.mimeType.startsWith('image/') && entry.size <= MAX_INLINE_IMAGE_BYTES
  useEffect(() => {
    if (!inline) {
      return
    }
    let live = true
    read(entry.attachmentId).then(
      ({ mimeType, base64 }) => live && setSrc(`data:${mimeType};base64,${base64}`),
      () => live && setSrc(null)
    )
    return () => {
      live = false
    }
  }, [inline, entry.attachmentId, read])
  return src
}

/** A file the assistant showed: images inline, anything else as a download. */
export function HomeChatAttachment({
  entry,
  actions
}: {
  entry: AttachmentEntry
  actions: HomeChatAttachmentActions
}): React.JSX.Element {
  const t = useTranslate()
  const src = useInlineImage(entry, actions.read)

  return (
    <div className="overflow-hidden rounded-md border border-border text-xs">
      {src && (
        <img src={src} alt={entry.name} className="max-h-96 w-full bg-muted/40 object-contain" />
      )}
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={entry.name}>
          {entry.name}
        </span>
        {entry.machine && (
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <Server className="size-3" />
            <span className="max-w-32 truncate">{entry.machine}</span>
          </span>
        )}
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatHomeChatBytes(entry.size)}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('homeChat.attachment.reveal', 'Show in folder')}
          onClick={() => actions.reveal(entry.attachmentId)}
        >
          <FolderOpen />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('homeChat.attachment.save', 'Save as…')}
          onClick={() => actions.save(entry.attachmentId, entry.name)}
        >
          <Download />
        </Button>
      </div>
    </div>
  )
}
