import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import {
  AGENT_CONFIG_LAYOUTS,
  isAgentConfigAgentId
} from '../../../../shared/agent-config/agent-config-catalog'
import type { AgentConfigLayout } from '../../../../shared/agent-config/agent-config-layout-types'
import { agentConfigMcpScopes } from '../../../../shared/agent-config/agent-config-mcp-scopes'
import type {
  AgentConfigAgentId,
  AgentConfigDocRef,
  AgentConfigMcpServer,
  AgentConfigScope
} from '../../../../shared/agent-config/agent-config-types'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { HostCombobox } from '../host-picker/HostCombobox'
import { agentConfigApi, agentConfigErrorText } from './model/agent-config-client'
import { useAgentConfig } from './model/agent-config-context'
import { agentConfigScopeLabel } from './model/agent-config-scope-labels'

export type AgentConfigCopyRequest =
  | { type: 'document'; doc: AgentConfigDocRef }
  | { type: 'mcp'; server: AgentConfigMcpServer }

const ACCOUNT = '@account'
const OTHER = '@other'

function accepts(
  layout: AgentConfigLayout,
  request: AgentConfigCopyRequest,
  inProject: boolean
): boolean {
  if (request.type === 'mcp') {
    return agentConfigMcpScopes(layout, inProject).length > 0
  }
  const scope = inProject ? layout.project : layout.user
  return request.doc.kind === 'instructions'
    ? scope.instructions.length > 0
    : scope.collections.some((collection) => collection.kind === request.doc.kind)
}

/** The usual move is account to project, or project to account, where some agent takes it. */
function usualPlace(
  request: AgentConfigCopyRequest,
  here: string | undefined,
  others: readonly string[]
): string {
  const scope = request.type === 'mcp' ? request.server.scope : request.doc.scope
  const order =
    here !== undefined && scope !== 'user'
      ? [ACCOUNT, ...others, OTHER]
      : [...(here === undefined ? [] : [here]), ...others, ACCOUNT]
  return (
    order.find((place) =>
      AGENT_CONFIG_LAYOUTS.some((layout) => accepts(layout, request, place !== ACCOUNT))
    ) ?? ACCOUNT
  )
}

/** Copies a document or a server to another agent, project or machine. */
export function AgentConfigCopyDialog({
  request,
  onClose
}: {
  request: AgentConfigCopyRequest | null
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { machine, machines, projects, target, reload } = useAgentConfig()
  const [machineId, setMachineId] = useState<MachineId>(machine.id)
  const [place, setPlace] = useState(ACCOUNT)
  const [otherPath, setOtherPath] = useState('')
  const [agent, setAgent] = useState<AgentConfigAgentId>(target.agent)
  const [privateToMe, setPrivateToMe] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seededFor, setSeededFor] = useState<AgentConfigCopyRequest | null>(null)
  if (seededFor !== request) {
    setSeededFor(request)
    setMachineId(machine.id)
    const paths = projects.filter((p) => p.machineId === machine.id).map((p) => p.path)
    const here = paths.find((path) => path === target.projectPath)
    setPlace(
      request
        ? usualPlace(
            request,
            here,
            paths.filter((path) => path !== here)
          )
        : ACCOUNT
    )
    setOtherPath('')
    setAgent(target.agent)
    setPrivateToMe(false)
    setOverwrite(false)
    setConflict(false)
    setError(null)
    setBusy(false)
  }

  const inProject = place !== ACCOUNT
  const projectPath = place === OTHER ? otherPath.trim() : place
  const projectsThere = projects.filter((project) => project.machineId === machineId)
  const agents = request
    ? AGENT_CONFIG_LAYOUTS.filter((layout) => accepts(layout, request, inProject))
    : []
  const chosenAgent = agents.some((layout) => layout.id === agent) ? agent : agents[0]?.id
  const canBePrivate =
    request?.type === 'mcp' &&
    inProject &&
    agents
      .filter((layout) => layout.id === chosenAgent)
      .some((layout) => agentConfigMcpScopes(layout, true).some((item) => item.scope === 'local'))
  const toScope: AgentConfigScope = !inProject
    ? 'user'
    : canBePrivate && privateToMe
      ? 'local'
      : 'project'
  const name = request?.type === 'mcp' ? request.server.name : (request?.doc.name ?? '')

  const submit = async (): Promise<void> => {
    if (!request || !chosenAgent || busy || (inProject && !projectPath)) {
      return
    }
    setBusy(true)
    setError(null)
    const to = { machineId, agent: chosenAgent, ...(inProject ? { projectPath } : {}) }
    try {
      await (request.type === 'mcp'
        ? agentConfigApi().copyMcpServer({
            target,
            scope: request.server.scope,
            name: request.server.name,
            to,
            toScope,
            overwrite
          })
        : agentConfigApi().copyDocument({
            target,
            ref: { kind: request.doc.kind, scope: request.doc.scope, path: request.doc.path },
            to,
            toScope,
            overwrite
          }))
      toast.success(t('auto.components.agentConfig.copy.done', 'Copied {{name}}', { name }))
      reload()
      onClose()
    } catch (failure) {
      const text = agentConfigErrorText(failure)
      setConflict(text.includes('already'))
      setError(text)
      setBusy(false)
    }
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-agent-config-copy>
        <DialogHeader>
          <DialogTitle>
            {t('auto.components.agentConfig.copy.title', 'Copy {{name}} to…', { name })}
          </DialogTitle>
          <DialogDescription>
            {request?.type === 'mcp'
              ? t(
                  'auto.components.agentConfig.copy.mcpDescription',
                  'The server goes straight from one machine’s file to the other’s, stored tokens included.'
                )
              : request?.doc.kind === 'skill'
                ? t(
                    'auto.components.agentConfig.copy.documentDescription',
                    'A skill is copied with every file in its folder.'
                  )
                : t(
                    'auto.components.agentConfig.copy.fileDescription',
                    'The file is copied as it is written.'
                  )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="agent-config-copy-machine">
              {t('auto.components.agentConfig.copy.machine', 'Machine')}
            </Label>
            <HostCombobox
              id="agent-config-copy-machine"
              value={machineId}
              onChange={(value) => {
                const chosen = machines.find((item) => item.id === value)
                if (chosen) {
                  setMachineId(chosen.id)
                  setPlace(ACCOUNT)
                }
              }}
              options={machines.map((item) => ({
                id: item.id,
                label: item.label,
                disabled: item.status !== 'online'
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-config-copy-place">
              {t('auto.components.agentConfig.copy.place', 'Where')}
            </Label>
            <Select value={place} onValueChange={setPlace}>
              <SelectTrigger id="agent-config-copy-place" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ACCOUNT}>
                  {t('auto.components.agentConfig.copy.account', 'The account on that machine')}
                </SelectItem>
                {projectsThere.map((project) => (
                  <SelectItem key={project.path} value={project.path}>
                    {project.label}
                    {projectsThere.some(
                      (other) => other !== project && other.label === project.label
                    ) ? (
                      <span className="ml-1 font-mono text-xs text-muted-foreground">
                        {project.path}
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>
                  {t('auto.components.agentConfig.copy.other', 'Another folder…')}
                </SelectItem>
              </SelectContent>
            </Select>
            {place === OTHER ? (
              <Input
                autoFocus
                value={otherPath}
                variant="code"
                placeholder={t('auto.components.agentConfig.example.folder', '/home/me/project')}
                aria-label={t('auto.components.agentConfig.copy.folder', 'Project folder')}
                onChange={(event) => setOtherPath(event.target.value)}
              />
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-config-copy-agent">
              {t('auto.components.agentConfig.copy.agent', 'Agent')}
            </Label>
            <Select
              value={chosenAgent ?? ''}
              onValueChange={(value) => isAgentConfigAgentId(value) && setAgent(value)}
            >
              <SelectTrigger id="agent-config-copy-agent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents.map((layout) => (
                  <SelectItem key={layout.id} value={layout.id}>
                    {layout.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {request && agents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'auto.components.agentConfig.copy.nowhere',
                'No agent keeps this kind of file there. Choose another place.'
              )}
            </p>
          ) : null}
          {canBePrivate ? (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={privateToMe}
                onCheckedChange={(checked) => setPrivateToMe(checked === true)}
              />
              {t(
                'auto.components.agentConfig.copy.private',
                'Only for me ({{scope}}), not in the project’s shared file',
                { scope: agentConfigScopeLabel('local', t) }
              )}
            </label>
          ) : null}
          {conflict ? (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={overwrite}
                onCheckedChange={(checked) => setOverwrite(checked === true)}
              />
              {t(
                'auto.components.agentConfig.copy.overwrite',
                'Replace what is there (it is kept in backups)'
              )}
            </label>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('auto.components.agentConfig.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            disabled={busy || !chosenAgent || (inProject && !projectPath)}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t('auto.components.agentConfig.copy.confirm', 'Copy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
