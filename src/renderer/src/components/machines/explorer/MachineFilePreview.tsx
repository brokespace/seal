import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { ImageViewer, MarkdownPreview, MonacoEditor } from '@/components/editor/editor-lazy-views'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { detectLanguage } from '../../../../../shared/editor-language/editor-language-detect'
import type { MachineFileEntry, MachineId } from '../../../../../shared/machines/machine-types'
import { MACHINE_PREVIEW_MAX_BYTES } from '../../../../../shared/machines/machine-types'
import { formatBytes, looksBinary, previewKindFor } from '../model/machine-format'

type LoadedFile = {
  base64: string
  text: string | null
  size: number
  truncated: boolean
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function loadingState(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  )
}

export function MachineFilePreview({
  machineId,
  path,
  entry,
  onClose,
  onDownload,
  readText,
  writeFile
}: {
  machineId: MachineId
  path: string
  entry: MachineFileEntry
  onClose: () => void
  onDownload: () => void
  /** Replaces the text shown for a text file, for callers that hide stored secrets. */
  readText?: (path: string) => Promise<string>
  /** Replaces the plain write, for callers that validate or back up first. */
  writeFile?: (path: string, content: string) => Promise<void>
}): React.JSX.Element {
  const t = useTranslate()
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const preview = previewKindFor(entry.name)
  const tooLarge = entry.size > MACHINE_PREVIEW_MAX_BYTES && preview.kind !== 'text'

  useEffect(() => {
    let cancelled = false
    setFile(null)
    setError(null)
    setDraft(null)
    const api = window.api.machines
    if (!api) {
      setError(t('auto.components.machines.preview.desktopOnly', 'Previews need the desktop app'))
      return
    }
    if (tooLarge) {
      return
    }
    void api
      .readFile({ machineId, path })
      .then(async (result) => {
        const bytes = decodeBase64(result.contentBase64)
        const binary = looksBinary(bytes)
        const shown = !binary && !result.truncated && readText ? await readText(path) : null
        if (cancelled) {
          return
        }
        setFile({
          base64: result.contentBase64,
          text: binary ? null : (shown ?? new TextDecoder().decode(bytes)),
          size: result.size,
          truncated: result.truncated
        })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [machineId, path, tooLarge, t, readText])

  const save = useCallback(
    async (content: string) => {
      const api = window.api.machines
      if (!api || saving) {
        return
      }
      setSaving(true)
      const write = writeFile
        ? writeFile(path, content)
        : api.writeFile({ machineId, path, content })
      const error = await write.then(
        () => null,
        (err: unknown) => (err instanceof Error ? err.message : String(err))
      )
      setSaving(false)
      if (error) {
        toast.error(error)
        return
      }
      setFile((previous) => (previous ? { ...previous, text: content } : previous))
      setDraft(null)
      toast.success(
        t('auto.components.machines.preview.saved', 'Saved {{name}}', { name: entry.name })
      )
    },
    [machineId, path, entry.name, saving, t, writeFile]
  )

  const canEdit = file?.text !== null && file?.truncated === false
  const dirty = draft !== null && draft !== file?.text

  let body: React.JSX.Element
  if (tooLarge) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        {t(
          'auto.components.machines.preview.tooLarge',
          'This file is {{size}}, too large to preview here.',
          { size: formatBytes(entry.size) }
        )}
        <Button type="button" variant="outline" size="sm" onClick={onDownload}>
          <Download />
          {t('auto.components.machines.preview.download', 'Download')}
        </Button>
      </div>
    )
  } else if (error) {
    body = (
      <p className="p-4 text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
        {error}
      </p>
    )
  } else if (!file) {
    body = loadingState()
  } else if (preview.kind === 'image' || preview.kind === 'pdf') {
    body = <ImageViewer content={file.base64} filePath={path} mimeType={preview.mimeType} />
  } else if (file.text === null) {
    body = (
      <p className="p-4 text-sm text-muted-foreground">
        {t('auto.components.machines.preview.binary', 'Binary file · {{size}}', {
          size: formatBytes(file.size)
        })}
      </p>
    )
  } else if (preview.kind === 'markdown' && draft === null) {
    body = (
      <div className="scrollbar-editor min-h-0 flex-1 overflow-auto">
        <MarkdownPreview
          content={file.text}
          filePath={path}
          scrollCacheKey={`machine:${machineId}:${path}`}
        />
      </div>
    )
  } else {
    const key = `machine:${machineId}:${path}`
    body = (
      <div className="min-h-0 flex-1">
        <MonacoEditor
          fileId={key}
          filePath={path}
          viewStateKey={key}
          relativePath={entry.name}
          content={draft ?? file.text}
          language={detectLanguage(path, file.text)}
          readOnly={!canEdit}
          onContentChange={setDraft}
          onSave={(content) => void save(content)}
        />
      </div>
    )
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor-surface"
      data-machine-preview
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {entry.name}
        </span>
        {file?.truncated ? (
          <span className="shrink-0 text-2xs text-muted-foreground">
            {t('auto.components.machines.preview.truncated', 'Showing first {{size}}', {
              size: formatBytes(MACHINE_PREVIEW_MAX_BYTES)
            })}
          </span>
        ) : null}
        {preview.kind === 'markdown' && canEdit && draft === null ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setDraft(file?.text ?? '')}
          >
            {t('auto.components.machines.preview.edit', 'Edit')}
          </Button>
        ) : null}
        {dirty ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={saving}
            onClick={() => draft !== null && void save(draft)}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {t('auto.components.machines.preview.save', 'Save')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('auto.components.machines.preview.download', 'Download')}
          onClick={onDownload}
        >
          <Download />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('auto.components.machines.preview.close', 'Close preview')}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <Suspense fallback={loadingState()}>{body}</Suspense>
    </section>
  )
}
