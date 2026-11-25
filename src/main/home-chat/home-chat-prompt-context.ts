import type { HomeChatAssistantServices } from './home-chat-assistant-services'
import { buildHomeChatSystemPrompt } from './home-chat-system-prompt'
import { describeSubagent } from './delegation/home-chat-subagents'
import type { HomeChatMachineProvider } from './machines/home-chat-machine-types'
import { renderHomeChatMemory } from './memory/home-chat-memory-prompt'
import { describeRoutine } from './routines/home-chat-routines'

export type HomeChatPromptSubject = {
  chatId: string
  isWorker: boolean
  lastMachine: string | null
}

/** Everything the assistant should see fresh every turn: memory, machines, skills and this chat's activity. */
export async function systemPromptForChat(
  services: HomeChatAssistantServices,
  machines: HomeChatMachineProvider,
  { chatId, isWorker, lastMachine }: HomeChatPromptSubject
): Promise<string> {
  const { skills } = services
  const [machineList, localSkills, remoteCatalogs, instructions, projectInstructions] =
    await Promise.all([
      machines.list(),
      skills.list().catch(() => []),
      skills.remoteCatalogs(machines).catch(() => []),
      skills.localInstructions().catch(() => []),
      skills.projectInstructions().catch(() => [])
    ])
  const activity = [
    ...services.jobs
      .list(chatId)
      .filter((job) => job.state === 'running')
      .map((job) => `job ${job.id} on ${job.machineLabel}: ${job.command.slice(0, 120)}`),
    ...services.subagents
      .list(chatId)
      .filter((item) => item.state === 'running')
      .map((item) => `subagent ${describeSubagent(item)}`),
    ...services.routines
      .list(chatId)
      .map((routine) => `routine ${describeRoutine(routine).split('\n')[0]}`)
  ]
  return buildHomeChatSystemPrompt({
    machines: machineList,
    memory: renderHomeChatMemory(services.memory.get()),
    skills: localSkills,
    remoteCatalogs,
    instructions,
    projectInstructions,
    activity,
    lastMachine,
    isWorker,
    now: new Date()
  })
}
