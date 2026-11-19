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
import type { AgentConfigAgentId } from '../../../../shared/agent-config/agent-config-types'
import { planAgentPlugin } from '../../../../shared/agent-plugins/agent-plugin-plan'
import type {
  AgentPluginComponents,
  AgentPluginListing,
  AgentPluginMachineResult,
  AgentPluginTargets
} from '../../../../shared/agent-plugins/agent-plugin-types'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { agentConfigApi } from '../agent-config/model/agent-config-client'
import { AgentPluginAgentList, linesFromPlan, linesFromStates } from './AgentPluginAgentList'
import {
  AgentPluginTargetPicker,
  agentPluginTargetsSummary,
  type AgentPluginTargetOptions
} from './AgentPluginTargetPicker'
import { failedMachineResult } from './use-agent-plugins-fleet'

export type AgentPluginApplyRequest = {
  name: string
  description: string
  listings: Pick<AgentPluginListing, 'harness' | 'id'>[]
  components: AgentPluginComponents | null
  targets: AgentPluginTargets
  /** Machines that have it now; a machine taken out of the targets has it removed. */
  installedOn: MachineId[]
  /** Agents on the machine the plan preview is for. */
  presentAgents: AgentConfigAgentId[]
}

export function AgentPluginApplyDialog({
  request,
  machines,
  options,
  onClose,
  onApplied
}: {
  request: AgentPluginApplyRequest | null
  machines: readonly MachineSummary[]
  options: AgentPluginTargetOptions
  onClose: () => void
  onApplied: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [seededFor, setSeededFor] = useState<AgentPluginApplyRequest | null>(null)
  const [targets, setTargets] = useState<AgentPluginTargets | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<AgentPluginMachineResult[] | null>(null)
  const [waiting, setWaiting] = useState<MachineId[]>([])
  if (seededFor !== request) {
    setSeededFor(request)
    setTargets(request?.targets ?? null)
    setPicking(false)
    setBusy(false)
    setResults(null)
    setWaiting([])
  }
  const changing = (request?.installedOn.length ?? 0) > 0
  const label = (machineId: MachineId): string =>
    machines.find((machine) => machine.id === machineId)?.label ?? machineId

  const apply = async (): Promise<void> => {
    if (!request || !targets) {
      return
    }
    setBusy(true)
    const online = new Set(machines.filter((m) => m.status === 'online').map((m) => m.id))
    const targeted = targets.machines === 'all' ? machines.map((m) => m.id) : targets.machines
    const into = targeted.filter((id) => online.has(id))
    // Only the selection takes a machine out; one that is unreachable right now keeps it.
    const outOf = request.installedOn.filter(
      (id) => targets.machines !== 'all' && !targets.machines.includes(id)
    )
    const api = agentConfigApi()
    const settled = await Promise.all([
      ...into.map((machineId) =>
        api
          .installAgentPlugin({
            machineId,
            request: { name: request.name, listings: request.listings, targets }
          })
          .catch((error: unknown) => failedMachineResult(machineId, error))
      ),
      ...outOf.map((machineId) =>
        api
          .removeAgentPlugin({ machineId, name: request.name })
          .catch((error: unknown) => failedMachineResult(machineId, error))
      )
    ])
    setResults(settled)
    setWaiting(targeted.filter((id) => !online.has(id)))
    setBusy(false)
    onApplied()
  }

  const preview =
    request?.components && targets
      ? linesFromPlan(
          planAgentPlugin({
            native: request.listings.map((listing) => listing.harness),
            components: request.components,
            presentAgents: request.presentAgents,
            agents: targets.agents
          }),
          request.components
        )
      : null

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        surface="security"
        scrollable
        className="sm:max-w-2xl"
        data-agent-plugin-apply=""
      >
        <DialogHeader>
          <DialogTitle>
            {changing
              ? t('seal.agentPlugins.apply.retargetTitle', 'Where {{name}} applies', {
                  name: request?.name ?? ''
                })
              : t('seal.agentPlugins.apply.installTitle', 'Install {{name}}', {
                  name: request?.name ?? ''
                })}
          </DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {request?.description ||
              t(
                'seal.agentPlugins.apply.description',
                'Agents whose marketplace has it install it themselves; the others get its MCP servers and skills.'
              )}
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <ul className="space-y-3" data-agent-plugin-results="">
            {results.map((result) => (
              <li key={result.machineId} className="space-y-1">
                <p className="text-sm font-medium">
                  {label(result.machineId)}{' '}
                  <span className={result.ok ? 'text-muted-foreground' : 'text-destructive'}>
                    {result.ok
                      ? t('seal.agentPlugins.apply.done', 'done')
                      : t('seal.agentPlugins.apply.failed', 'needs attention')}
                  </span>
                </p>
                {result.error ? (
                  <p className="text-xs text-destructive [overflow-wrap:anywhere]">
                    {result.error}
                  </p>
                ) : null}
                {result.steps
                  .filter((step) => !step.ok || step.command)
                  .map((step) => (
                    <div key={`${step.label}:${step.command ?? ''}`} className="text-xs">
                      <p className={step.ok ? 'text-muted-foreground' : 'text-destructive'}>
                        {step.command ? `$ ${step.command}` : step.label}
                      </p>
                      {!step.ok && step.output ? (
                        <pre className="scrollbar-sleek max-h-32 overflow-auto font-mono whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                          {step.output}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                {result.record ? (
                  <AgentPluginAgentList lines={linesFromStates(result.record.agents)} />
                ) : null}
              </li>
            ))}
            {waiting.map((machineId) => (
              <li key={machineId} className="text-sm">
                <span className="font-medium">{label(machineId)}</span>{' '}
                <span className="text-muted-foreground">
                  {t('seal.agentPlugins.apply.waiting', 'will apply when it’s online')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t('seal.agentPlugins.apply.perAgent', 'What each agent gets')}
              </h3>
              {preview ? (
                <AgentPluginAgentList lines={preview} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'seal.agentPlugins.apply.unknownContents',
                    'Its MCP servers and skills are read from the plugin once it is installed.'
                  )}
                </p>
              )}
            </section>
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t('seal.agentPlugins.apply.applyTo', 'Apply to')}
                </h3>
                <span className="min-w-0 flex-1 truncate text-xs">
                  {targets ? agentPluginTargetsSummary(targets, options, t) : ''}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={picking}
                  onClick={() => setPicking((open) => !open)}
                >
                  {picking
                    ? t('seal.agentPlugins.apply.hidePicker', 'Done')
                    : t('seal.agentPlugins.apply.showPicker', 'Change…')}
                </Button>
              </div>
              {picking && targets ? (
                <AgentPluginTargetPicker value={targets} options={options} onChange={setTargets} />
              ) : null}
            </section>
          </div>
        )}

        <DialogFooter>
          {results ? (
            <Button type="button" onClick={onClose}>
              {t('seal.agentPlugins.apply.close', 'Close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                {t('seal.agentPlugins.apply.cancel', 'Cancel')}
              </Button>
              <Button type="button" disabled={busy || !targets} onClick={() => void apply()}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {changing
                  ? t('seal.agentPlugins.apply.save', 'Apply')
                  : t('seal.agentPlugins.apply.install', 'Install')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
