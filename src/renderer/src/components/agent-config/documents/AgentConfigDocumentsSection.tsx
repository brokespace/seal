import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import type { AgentConfigCollection } from '../../../../../shared/agent-config/agent-config-catalog'
import { agentConfigDocNameProblem } from '../../../../../shared/agent-config/agent-config-doc-names'
import type {
  AgentConfigDocRef,
  AgentConfigScope
} from '../../../../../shared/agent-config/agent-config-types'
import { machinePathBasename } from '../../../../../shared/machines/machine-paths'
import {
  MachinePromptDialog,
  type MachinePromptRequest
} from '../../machines/explorer/MachinePromptDialog'
import { SettingsGroup } from '../../settings/section-layout/SettingsGroup'
import {
  AgentConfigConfirmDialog,
  type AgentConfigConfirmRequest
} from '../AgentConfigConfirmDialog'
import { AgentConfigCopyDialog, type AgentConfigCopyRequest } from '../AgentConfigCopyDialog'
import { agentConfigApi } from '../model/agent-config-client'
import { useAgentConfig } from '../model/agent-config-context'
import {
  AgentConfigDocumentRow,
  type AgentConfigDocumentRowActions
} from './AgentConfigDocumentRow'
import { AgentConfigDocumentSheet, type AgentConfigOpenDocument } from './AgentConfigDocumentSheet'
import {
  agentConfigKindNoun,
  agentConfigKindTitle,
  missingInstructions,
  openDocumentFor
} from './agent-config-document-kinds'

function inCollection(doc: AgentConfigDocRef, collection: AgentConfigCollection): boolean {
  return (
    doc.kind === collection.kind && doc.path.replaceAll('\\', '/').includes(`/${collection.dir}/`)
  )
}

function emptyRow(text: string): React.JSX.Element {
  return (
    <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
      {text}
    </p>
  )
}

export function AgentConfigDocumentsSection(): React.JSX.Element {
  const t = useTranslate()
  const { layout, snapshot, target, homeScope, machine, apply, reload } = useAgentConfig()
  const [open, setOpen] = useState<AgentConfigOpenDocument | null>(null)
  const [prompt, setPrompt] = useState<MachinePromptRequest | null>(null)
  const [confirm, setConfirm] = useState<AgentConfigConfirmRequest | null>(null)
  const [copy, setCopy] = useState<AgentConfigCopyRequest | null>(null)
  const scopeLayout = homeScope === 'user' ? layout.user : layout.project
  const instructions = snapshot.docs.filter((doc) => doc.kind === 'instructions')
  const creatable = missingInstructions(layout, homeScope, snapshot.docs)
  const nestedName = homeScope === 'project' ? layout.project.nestedInstructions[0] : undefined

  const nameField = (kind: AgentConfigDocRef['kind'], initialValue: string) => ({
    id: 'agent-config-doc-name',
    label: t('auto.components.agentConfig.name', 'Name'),
    initialValue,
    validate: (value: string) => agentConfigDocNameProblem(kind, value)
  })
  const ref = (doc: AgentConfigDocRef) => ({ kind: doc.kind, scope: doc.scope, path: doc.path })
  const entryName = (doc: AgentConfigDocRef): string =>
    doc.directory
      ? machinePathBasename(doc.directory)
      : machinePathBasename(doc.path).replace(/\.[^.]+$/, '')

  const createInstructions = (scope: AgentConfigScope, relative: string): void => {
    void apply(() =>
      agentConfigApi().createDocument({ target, kind: 'instructions', scope, name: relative })
    ).then((result) => {
      if (result) {
        setOpen({ path: result.path, title: relative, validation: 'instructions', scope })
      }
    })
  }

  const actions: AgentConfigDocumentRowActions = {
    open: (doc) => setOpen(openDocumentFor(doc)),
    duplicate: (doc) =>
      setPrompt({
        title: t('auto.components.agentConfig.duplicateTitle', 'Duplicate {{name}}', {
          name: doc.name
        }),
        confirmLabel: t('auto.components.agentConfig.duplicateConfirm', 'Duplicate'),
        fields: [nameField(doc.kind, `${entryName(doc)}-copy`)],
        onSubmit: async ([name]) => {
          await agentConfigApi().duplicateDocument({ target, ref: ref(doc), newName: name ?? '' })
          reload()
        }
      }),
    rename: (doc) =>
      setPrompt({
        title: t('auto.components.agentConfig.renameTitle', 'Rename {{name}}', {
          name: doc.name
        }),
        description:
          doc.kind === 'skill' || doc.kind === 'subagent'
            ? t(
                'auto.components.agentConfig.renameDescription',
                'The name declared inside the file is updated to match.'
              )
            : undefined,
        confirmLabel: t('auto.components.agentConfig.renameConfirm', 'Rename'),
        fields: [nameField(doc.kind, entryName(doc))],
        onSubmit: async ([name]) => {
          if (name && name !== entryName(doc)) {
            await agentConfigApi().renameDocument({ target, ref: ref(doc), newName: name })
            reload()
          }
        }
      }),
    copy: (doc) => setCopy({ type: 'document', doc }),
    remove: (doc) =>
      setConfirm({
        title: t('auto.components.agentConfig.deleteTitle', 'Delete {{name}}?', {
          name: doc.relativePath ?? doc.name
        }),
        description: doc.directory
          ? t(
              'auto.components.agentConfig.deleteFolderDescription',
              'The whole folder {{path}} is moved to Seal’s backups on {{machine}}; restore it from Files & backups.',
              { path: doc.directory, machine: machine.label }
            )
          : t(
              'auto.components.agentConfig.deleteDescription',
              '{{path}} is moved to Seal’s backups on {{machine}}; restore it from Files & backups.',
              { path: doc.path, machine: machine.label }
            ),
        confirmLabel: t('auto.components.agentConfig.deleteConfirm', 'Delete'),
        destructive: true,
        run: async () => {
          await agentConfigApi().deleteDocument({ target, ref: ref(doc) })
          reload()
        }
      })
  }

  const create = (collection: AgentConfigCollection): void =>
    setPrompt({
      title: t('auto.components.agentConfig.newTitle', 'New {{kind}}', {
        kind: agentConfigKindNoun(collection.kind, t)
      }),
      description: `${homeScope === 'user' ? '~/' : ''}${collection.dir}`,
      confirmLabel: t('auto.components.agentConfig.create', 'Create'),
      fields: [nameField(collection.kind, '')],
      onSubmit: async ([name]) => {
        const result = await agentConfigApi().createDocument({
          target,
          kind: collection.kind,
          scope: homeScope,
          name: name ?? '',
          collectionDir: collection.dir
        })
        reload()
        setOpen({
          path: result.path,
          title: name ?? '',
          validation: collection.extension === '.toml' ? 'toml' : collection.kind,
          scope: homeScope,
          ...(collection.kind === 'skill' || collection.kind === 'subagent'
            ? { expectedName: name ?? '' }
            : {})
        })
      }
    })

  const createNested = (): void =>
    setPrompt({
      title: t('auto.components.agentConfig.nestedTitle', 'Instructions for a sub-folder'),
      description: t(
        'auto.components.agentConfig.nestedDescription',
        'The agent reads {{file}} in a folder when it works on files there.',
        { file: nestedName ?? '' }
      ),
      confirmLabel: t('auto.components.agentConfig.create', 'Create'),
      fields: [
        {
          id: 'agent-config-nested-folder',
          label: t('auto.components.agentConfig.nestedFolder', 'Folder, from the project root'),
          placeholder: t('auto.components.agentConfig.example.subfolder', 'packages/api'),
          initialValue: '',
          validate: (value) =>
            /^[^/\\][^\\]*$/.test(value) && !value.split('/').includes('..')
              ? null
              : t('auto.components.agentConfig.nestedInvalid', 'Enter a folder inside the project.')
        }
      ],
      onSubmit: async ([folder]) => {
        const relative = `${(folder ?? '').replace(/\/+$/, '')}/${nestedName}`
        const result = await agentConfigApi().createDocument({
          target,
          kind: 'instructions',
          scope: 'project',
          name: relative
        })
        reload()
        setOpen({
          path: result.path,
          title: relative,
          validation: 'instructions',
          scope: 'project'
        })
      }
    })

  return (
    <div className="space-y-6" data-agent-config-section="documents">
      <SettingsGroup
        title={agentConfigKindTitle('instructions', t)}
        description={
          homeScope === 'user'
            ? t(
                'auto.components.agentConfig.instructionsUser',
                'What {{agent}} is told in every project on this machine.',
                { agent: layout.label }
              )
            : t(
                'auto.components.agentConfig.instructionsProject',
                'What {{agent}} is told in this project, including files in sub-folders.',
                { agent: layout.label }
              )
        }
        action={
          creatable.length > 0 || nestedName ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Plus />
                  {t('auto.components.agentConfig.new', 'New')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {creatable.map((item) => (
                  <DropdownMenuItem
                    key={`${item.scope}:${item.relative}`}
                    onSelect={() => createInstructions(item.scope, item.relative)}
                  >
                    <span className="font-mono text-xs">{item.relative}</span>
                  </DropdownMenuItem>
                ))}
                {nestedName ? (
                  <DropdownMenuItem onSelect={createNested}>
                    {t('auto.components.agentConfig.nestedAction', 'In a sub-folder…')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      >
        {instructions.length === 0
          ? emptyRow(t('auto.components.agentConfig.noInstructions', 'No instructions file yet.'))
          : instructions.map((doc) => (
              <AgentConfigDocumentRow
                key={doc.path}
                doc={doc}
                showScope={doc.scope === 'local'}
                actions={actions}
              />
            ))}
      </SettingsGroup>

      {scopeLayout.collections.map((collection) => {
        const docs = snapshot.docs.filter((doc) => inCollection(doc, collection))
        return (
          <SettingsGroup
            key={collection.dir}
            title={agentConfigKindTitle(collection.kind, t)}
            description={
              <span className="font-mono">{`${homeScope === 'user' ? '~/' : ''}${collection.dir}`}</span>
            }
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-agent-config-new={collection.kind}
                onClick={() => create(collection)}
              >
                <Plus />
                {t('auto.components.agentConfig.new', 'New')}
              </Button>
            }
          >
            {docs.length === 0
              ? emptyRow(t('auto.components.agentConfig.noneHere', 'Nothing here yet.'))
              : docs.map((doc) => (
                  <AgentConfigDocumentRow
                    key={doc.path}
                    doc={doc}
                    showScope={false}
                    actions={actions}
                  />
                ))}
          </SettingsGroup>
        )
      })}

      <AgentConfigDocumentSheet document={open} onClose={() => setOpen(null)} />
      <MachinePromptDialog request={prompt} onClose={() => setPrompt(null)} />
      <AgentConfigConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <AgentConfigCopyDialog request={copy} onClose={() => setCopy(null)} />
    </div>
  )
}
