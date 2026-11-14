import React, { useEffect, useState } from 'react'
import { Bot, FolderGit2, Plus, SquareTerminal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { getAgentCatalog, type AgentCatalogEntry } from '@/lib/agent-catalog/agent-catalog'
import {
  joinMachinePath,
  machinePathBasename,
  machinePathDirname
} from '../../../../../shared/machines/machine-paths'
import type { MachineWorktree } from '../../../../../shared/machines/machine-view'
import { launchMachineAgent, openMachineTerminal } from '../detail/machine-quick-actions'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import {
  classifyMachineWorktreeRemovalRefusal,
  machineWorktreeRemovalWaiver
} from '../../../../../shared/machines/machine-worktree-removal-refusal'
import { readIpcErrorDetail } from '@/runtime/errors/ipc-error'
import {
  MachineWorktreeForceRemoveDialog,
  type MachineWorktreeForceRemoveRequest
} from './MachineWorktreeForceRemoveDialog'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useInstalledAgents(machine: MachineSummary, online: boolean): AgentCatalogEntry[] {
  const [installed, setInstalled] = useState<AgentCatalogEntry[]>([])
  useEffect(() => {
    if (!online || machine.connection === 'local') {
      return
    }
    let cancelled = false
    const catalog = getAgentCatalog()
    void window.api.machines
      ?.detectCommands({ machineId: machine.id, commands: catalog.map((entry) => entry.cmd) })
      .then((found) => {
        if (!cancelled) {
          const present = new Set(found)
          setInstalled(catalog.filter((entry) => present.has(entry.cmd)))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [machine.id, machine.connection, online])
  return installed
}

function AgentMenu({
  machine,
  agents,
  cwd
}: {
  machine: MachineSummary
  agents: readonly AgentCatalogEntry[]
  cwd?: string
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" disabled={agents.length === 0}>
          <Bot />
          {t('auto.components.machines.work.startAgent', 'Start agent')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onSelect={() => launchMachineAgent(machine, agent.id, cwd ? { cwd } : {})}
          >
            {agent.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Agents and git worktrees on a remote machine, run through its connection like everything else. */
async function runWorktreeWork(
  work: () => Promise<MachineWorktree[] | undefined>,
  setBusy: (busy: boolean) => void,
  setWorktrees: (worktrees: MachineWorktree[]) => void
): Promise<void> {
  setBusy(true)
  try {
    const next = await work()
    if (next) {
      setWorktrees(next)
    }
  } catch (error) {
    toast.error(errorText(error))
  } finally {
    setBusy(false)
  }
}

type RemovalWaiver = { force?: true; unlock?: true }

/** Removes a worktree; a refusal Git lets the user waive becomes a question, not a failure. */
async function removeWorktreeOrAsk(removal: {
  path: string
  label: string
  waiver: RemovalWaiver
  remove: () => Promise<MachineWorktree[] | undefined>
  setBusy: (busy: boolean) => void
  setWorktrees: (worktrees: MachineWorktree[]) => void
  askToForce: (request: MachineWorktreeForceRemoveRequest) => void
  failedTitle: string
}): Promise<void> {
  const { path, label, waiver } = removal
  removal.setBusy(true)
  try {
    const next = await removal.remove()
    if (next) {
      removal.setWorktrees(next)
    }
  } catch (error) {
    const detail = readIpcErrorDetail(error) ?? errorText(error)
    const refusal = classifyMachineWorktreeRemovalRefusal(detail)
    // Why: a refusal the waiver already answered is a real failure, not another question.
    if (refusal && !(waiver.force && (refusal.kind !== 'locked' || waiver.unlock))) {
      removal.askToForce({ path, label, refusal })
    } else {
      toast.error(removal.failedTitle, { description: detail, duration: Infinity })
    }
  } finally {
    removal.setBusy(false)
  }
}

export function MachineWorkSection({
  machine,
  online,
  homeDir
}: {
  machine: MachineSummary
  online: boolean
  homeDir: string | null
}): React.JSX.Element | null {
  const t = useTranslate()
  const agents = useInstalledAgents(machine, online)
  const [repoPath, setRepoPath] = useState('')
  const [branch, setBranch] = useState('')
  const [worktrees, setWorktrees] = useState<MachineWorktree[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [forceRequest, setForceRequest] = useState<MachineWorktreeForceRemoveRequest | null>(null)
  if (machine.connection === 'local' || !online) {
    return null
  }
  const machines = window.api.machines
  const run = (work: () => Promise<MachineWorktree[] | undefined>): Promise<void> =>
    runWorktreeWork(work, setBusy, setWorktrees)
  const repo = repoPath.trim()
  const load = (): Promise<void> =>
    run(async () => machines?.listWorktrees({ machineId: machine.id, repoPath: repo }))
  const create = (): Promise<void> => {
    const name = branch.trim()
    const parent = machinePathDirname(repo)
    if (!name || !parent) {
      return Promise.resolve()
    }
    const path = joinMachinePath(
      parent,
      `${machinePathBasename(repo)}-${name.replace(/[^A-Za-z0-9._-]+/g, '-')}`
    )
    return run(async () => {
      const next = await machines?.createWorktree({
        machineId: machine.id,
        repoPath: repo,
        path,
        branch: name
      })
      setBranch('')
      return next
    })
  }
  const remove = (path: string, label: string, waiver: RemovalWaiver = {}): Promise<void> =>
    removeWorktreeOrAsk({
      path,
      label,
      waiver,
      remove: async () =>
        machines?.removeWorktree({ machineId: machine.id, repoPath: repo, path, ...waiver }),
      setBusy,
      setWorktrees,
      askToForce: setForceRequest,
      failedTitle: t('auto.components.machines.work.removeFailed', 'Could not remove worktree')
    })

  return (
    <section className="space-y-2" data-machine-work>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-xs font-semibold">
          {t('auto.components.machines.work.title', 'Agents & worktrees')}
        </h3>
        <AgentMenu machine={machine} agents={agents} cwd={homeDir ?? undefined} />
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (repo) {
            void load()
          }
        }}
      >
        <Input
          variant="code"
          className="h-7 flex-1"
          value={repoPath}
          placeholder={t(
            'auto.components.machines.work.repoPlaceholder',
            'Repository path, e.g. {{path}}',
            {
              path: homeDir ? joinMachinePath(homeDir, 'project') : '~/project'
            }
          )}
          onChange={(event) => setRepoPath(event.target.value)}
        />
        <Button type="submit" variant="outline" size="xs" disabled={!repo || busy}>
          <FolderGit2 />
          {t('auto.components.machines.work.list', 'Worktrees')}
        </Button>
      </form>
      {worktrees ? (
        <div className="space-y-1">
          <ul className="space-y-0.5">
            {worktrees.map((worktree) => (
              <li
                key={worktree.path}
                className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent/50"
              >
                <span className="shrink-0 font-medium">
                  {worktree.branch ?? worktree.head?.slice(0, 8) ?? ''}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
                  {worktree.path}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('auto.components.machines.work.terminalHere', 'Terminal here')}
                  onClick={() => openMachineTerminal(machine, worktree.path)}
                >
                  <SquareTerminal />
                </Button>
                <AgentMenu machine={machine} agents={agents} cwd={worktree.path} />
                {worktree.path !== worktrees[0]?.path ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('auto.components.machines.work.remove', 'Remove worktree')}
                    disabled={busy}
                    onClick={() =>
                      void remove(
                        worktree.path,
                        worktree.branch ?? machinePathBasename(worktree.path)
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <Input
              className="h-7 flex-1"
              value={branch}
              placeholder={t('auto.components.machines.work.branchPlaceholder', 'New branch name')}
              onChange={(event) => setBranch(event.target.value)}
            />
            <Button type="submit" variant="outline" size="xs" disabled={!branch.trim() || busy}>
              <Plus />
              {t('auto.components.machines.work.create', 'New worktree')}
            </Button>
          </form>
        </div>
      ) : null}
      <MachineWorktreeForceRemoveDialog
        request={forceRequest}
        onCancel={() => setForceRequest(null)}
        onConfirm={(request) => {
          setForceRequest(null)
          void remove(request.path, request.label, machineWorktreeRemovalWaiver(request.refusal))
        }}
      />
    </section>
  )
}
