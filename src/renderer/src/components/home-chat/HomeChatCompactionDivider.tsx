import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import CommentMarkdown from '../sidebar/CommentMarkdown'
import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'

type CompactionEntry = Extract<HomeChatEntry, { kind: 'compaction' }>

/** Marks where the model stopped reading the thread verbatim; the summary it reads instead opens on demand. */
export function HomeChatCompactionDivider({
  entry
}: {
  entry: CompactionEntry
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs text-muted-foreground" data-home-chat-compaction>
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-border" />
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 hover:text-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          {entry.auto
            ? t('homeChat.compaction.auto', 'Earlier messages summarized for the model')
            : t('homeChat.compaction.manual', 'Earlier messages summarized at your request')}
        </button>
        <span className="h-px flex-1 bg-border" />
      </div>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <CommentMarkdown
            className="text-xs text-muted-foreground"
            content={entry.summary}
            variant="document"
          />
        </div>
      )}
    </div>
  )
}
