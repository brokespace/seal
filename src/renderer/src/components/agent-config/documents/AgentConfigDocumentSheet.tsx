import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { MarkdownPreview, MonacoEditor } from '@/components/editor/editor-lazy-views'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { validateAgentConfigContent } from '../../../../../shared/agent-config/agent-config-validation'
import type {
  AgentConfigScope,
  AgentConfigValidationKind
} from '../../../../../shared/agent-config/agent-config-types'
import { detectLanguage } from '../../../../../shared/editor-language/editor-language-detect'
import { SettingsSegmentedControl } from '../../settings/form-controls/SettingsFormControls'
import { AgentConfigScopeBadge } from '../AgentConfigScopeBadge'
import { agentConfigApi, agentConfigErrorText } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'

export type AgentConfigOpenDocument = {
  path: string
  title: string
  validation: AgentConfigValidationKind
  /** Folder or file name the document's declared name should match. */
  expectedName?: string
  scope?: AgentConfigScope
}

type ViewMode = 'edit' | 'split' | 'preview'
type Loaded = { content: string; hash: string; exists: boolean }

function spinner(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  )
}

/** One editor for every file Seal manages: live checks, preview for markdown, safe save. */
export function AgentConfigDocumentSheet({
  document,
  onClose
}: {
  document: AgentConfigOpenDocument | null
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { target, reload } = useAgentConfig()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<ViewMode>('split')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const path = document?.path ?? null
  const markdown = path !== null && /\.(md|mdc)$/i.test(path)

  const load = useCallback(() => {
    if (!path) {
      return () => {}
    }
    let cancelled = false
    setLoaded(null)
    setError(null)
    setConfirmDiscard(false)
    void Promise.resolve()
      .then(() => agentConfigApi().readDocument({ target, path }))
      .then(
        (file) => {
          if (!cancelled) {
            setLoaded(file)
            setDraft(file.content)
          }
        },
        (failure: unknown) => {
          if (!cancelled) {
            setError(agentConfigErrorText(failure))
          }
        }
      )
    return () => {
      cancelled = true
    }
  }, [path, target])
  useEffect(() => load(), [load])

  const issues = useMemo(
    () =>
      document && loaded
        ? validateAgentConfigContent(document.validation, draft, document.expectedName)
        : [],
    [document, draft, loaded]
  )
  const blocked = issues.some((issue) => issue.severity === 'error')
  const dirty = loaded !== null && draft !== loaded.content

  const save = async (content: string): Promise<void> => {
    if (!document || !loaded || saving) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await agentConfigApi().saveDocument({
        target,
        path: document.path,
        content,
        validation: document.validation,
        ...(loaded.exists ? { expectedHash: loaded.hash } : {}),
        ...(document.expectedName ? { expectedName: document.expectedName } : {})
      })
      setLoaded({ content, hash: result.hash, exists: true })
      setDraft(content)
      toast.success(
        result.backupPath
          ? t(
              'auto.components.agentConfig.editor.savedWithBackup',
              'Saved {{name}}. The previous version is in backups.',
              { name: document.title }
            )
          : t('auto.components.agentConfig.editor.saved', 'Saved {{name}}', {
              name: document.title
            })
      )
      reload()
    } catch (failure) {
      setError(agentConfigErrorText(failure))
    }
    setSaving(false)
  }

  const requestClose = (): void => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    onClose()
  }

  const editorKey = `agent-config:${target.machineId}:${path ?? ''}`
  const editor = (
    <div className={cn('min-h-0 min-w-0 flex-1', mode === 'preview' && markdown && 'hidden')}>
      <MonacoEditor
        fileId={editorKey}
        filePath={path ?? ''}
        viewStateKey={editorKey}
        relativePath={document?.title ?? ''}
        content={draft}
        language={detectLanguage(path ?? '', draft)}
        onContentChange={setDraft}
        onSave={(content) => void save(content)}
      />
    </div>
  )

  return (
    <Sheet open={document !== null} onOpenChange={(open) => !open && requestClose()}>
      <SheetContent className="w-[92vw] sm:max-w-[1100px]" data-agent-config-editor={path ?? ''}>
        <div className="shrink-0 border-b border-border pr-8">
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <SheetTitle>
                  <span className="block truncate">{document?.title}</span>
                </SheetTitle>
              </div>
              {document?.scope ? <AgentConfigScopeBadge scope={document.scope} /> : null}
            </div>
            <SheetDescription>
              <span className="block truncate font-mono text-xs" title={path ?? undefined}>
                {path}
              </span>
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          {markdown ? (
            <SettingsSegmentedControl
              size="sm"
              value={mode}
              onChange={setMode}
              ariaLabel={t('auto.components.agentConfig.editor.view', 'View')}
              options={[
                { value: 'edit', label: t('auto.components.agentConfig.editor.edit', 'Edit') },
                { value: 'split', label: t('auto.components.agentConfig.editor.split', 'Split') },
                {
                  value: 'preview',
                  label: t('auto.components.agentConfig.editor.preview', 'Preview')
                }
              ]}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {loaded && !loaded.exists
              ? t(
                  'auto.components.agentConfig.editor.newFile',
                  'This file does not exist yet; saving creates it.'
                )
              : dirty
                ? t('auto.components.agentConfig.editor.unsaved', 'Unsaved changes')
                : ''}
          </span>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setDraft(loaded?.content ?? '')}
            >
              {t('auto.components.agentConfig.editor.revert', 'Revert')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!dirty || blocked || saving}
            onClick={() => void save(draft)}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {t('auto.components.agentConfig.editor.save', 'Save')}
          </Button>
        </div>

        {confirmDiscard ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs">
            <span className="flex-1">
              {t(
                'auto.components.agentConfig.editor.discardPrompt',
                'This file has unsaved changes.'
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setConfirmDiscard(false)}
            >
              {t('auto.components.agentConfig.editor.keepEditing', 'Keep editing')}
            </Button>
            <Button type="button" variant="outline" size="xs" onClick={onClose}>
              {t('auto.components.agentConfig.editor.discard', 'Discard changes')}
            </Button>
          </div>
        ) : null}

        {error ? (
          <div
            className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-2 text-xs text-destructive"
            role="alert"
          >
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{error}</span>
            {loaded ? (
              <Button type="button" variant="outline" size="xs" onClick={() => load()}>
                {t('auto.components.agentConfig.editor.reload', 'Reload from the machine')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 bg-editor-surface">
          <Suspense fallback={spinner()}>
            {loaded ? (
              <>
                {editor}
                {markdown && mode !== 'edit' ? (
                  <div
                    className={cn(
                      'scrollbar-editor min-h-0 min-w-0 flex-1 overflow-auto',
                      mode === 'split' && 'border-l border-border'
                    )}
                  >
                    <MarkdownPreview
                      content={draft}
                      filePath={path ?? ''}
                      scrollCacheKey={`${editorKey}:preview`}
                    />
                  </div>
                ) : null}
              </>
            ) : error ? null : (
              spinner()
            )}
          </Suspense>
        </div>

        {issues.length > 0 ? (
          <ul
            className="scrollbar-sleek max-h-32 shrink-0 space-y-1 overflow-auto border-t border-border px-4 py-2 text-xs"
            data-agent-config-issues
          >
            {issues.map((issue) => (
              <li
                key={`${issue.field ?? ''}:${issue.message}`}
                className={cn(
                  'flex items-start gap-1.5',
                  issue.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span className="[overflow-wrap:anywhere]">{issue.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
