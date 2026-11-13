import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { HomeChatMachineNote } from '../../shared/home-chat/home-chat-memory-types'
import type { HomeChatNoticeSource } from '../../shared/home-chat/home-chat-types'
import type { Repo } from '../../shared/repo-types'
import type { HomeChatAssistantServices, HomeChatSealAccess } from './home-chat-assistant-services'
import { HomeChatAttachments } from './attachments/home-chat-attachments'
import { HomeChatSubagents, type HomeChatWorkerHost } from './delegation/home-chat-subagents'
import { HomeChatJobRegistry, type HomeChatJob } from './jobs/home-chat-job-registry'
import type { HomeChatMachineProvider } from './machines/home-chat-machine-types'
import { HomeChatMemoryStore } from './memory/home-chat-memory-store'
import { HomeChatRoutines } from './routines/home-chat-routines'
import { HomeChatSkills } from './skills/home-chat-skills'
import type { HomeChatToolContext } from './tools/home-chat-tool-executor'
import type { HomeChatWebConfig } from './web/home-chat-web'

export type HomeChatRuntimeDeps = {
  rootDir: string
  createMachines: (machineNotes: () => readonly HomeChatMachineNote[]) => HomeChatMachineProvider
  runOrcaCli: HomeChatToolContext['runOrcaCli']
  repos: () => Repo[]
  webConfig: () => HomeChatWebConfig
  wake: (chatId: string, source: HomeChatNoticeSource, text: string) => void
  memoryChanged: () => void
  workers: HomeChatWorkerHost
  seal: HomeChatSealAccess
}

export type HomeChatAssistantRuntime = {
  services: HomeChatAssistantServices
  machines: HomeChatMachineProvider
  load: () => Promise<void>
  dispose: () => void
}

export function jobEndedNotice(job: HomeChatJob, tail: string): string {
  const outcome =
    job.state === 'exited'
      ? `exited with code ${job.exitCode ?? 'unknown'}`
      : job.state === 'lost'
        ? 'is gone without an exit code (the machine may have rebooted)'
        : job.state
  const output = tail.trim() ? `\nLast output:\n${tail.trimEnd()}` : '\n(no output)'
  return `Background job ${job.id} on ${job.machineLabel} ${outcome}.\nCommand: ${job.command.slice(0, 300)}${output}`
}

export function createHomeChatAssistantRuntime(
  deps: HomeChatRuntimeDeps
): HomeChatAssistantRuntime {
  const memory = new HomeChatMemoryStore(deps.rootDir, deps.memoryChanged)
  const machines = deps.createMachines(() => memory.machineNotes())
  const jobs = new HomeChatJobRegistry({
    rootDir: deps.rootDir,
    machines,
    onJobEnded: (job, tail) => deps.wake(job.chatId, 'job', jobEndedNotice(job, tail))
  })
  const subagents = new HomeChatSubagents({
    rootDir: deps.rootDir,
    runOrcaCli: deps.runOrcaCli,
    workers: deps.workers,
    onSettled: (item) =>
      deps.wake(
        item.chatId,
        'subagent',
        `Subagent ${item.id} "${item.title}" is ${item.state}.${item.result?.trim() ? `\nIts latest output:\n${item.result.trim()}` : ''}`
      )
  })
  const routines = new HomeChatRoutines({
    rootDir: deps.rootDir,
    onFire: (routine) =>
      deps.wake(
        routine.chatId,
        'routine',
        `Routine "${routine.name}" (${routine.id}) is due. Its prompt:\n${routine.prompt}`
      )
  })
  const services: HomeChatAssistantServices = {
    jobs,
    memory,
    skills: new HomeChatSkills({ sealSkillsDir: join(deps.rootDir, 'skills'), repos: deps.repos }),
    subagents,
    routines,
    attachments: new HomeChatAttachments(deps.rootDir),
    seal: deps.seal,
    webConfig: deps.webConfig
  }
  return {
    services,
    machines,
    load: async () => {
      await mkdir(deps.rootDir, { recursive: true })
      await memory.load()
      await Promise.all([jobs.load(), subagents.load(), routines.load()])
    },
    dispose: () => {
      jobs.dispose()
      subagents.dispose()
      routines.dispose()
    }
  }
}
