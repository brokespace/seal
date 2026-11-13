import type { HomeChatAttachments } from './attachments/home-chat-attachments'
import type { HomeChatSubagents } from './delegation/home-chat-subagents'
import type { HomeChatJobRegistry } from './jobs/home-chat-job-registry'
import type { HomeChatMemoryStore } from './memory/home-chat-memory-store'
import type { HomeChatRoutines } from './routines/home-chat-routines'
import type { HomeChatSkills } from './skills/home-chat-skills'
import type { HomeChatWebConfig } from './web/home-chat-web'

/** Long-lived assistant services shared by every chat. */
export type HomeChatAssistantServices = {
  jobs: HomeChatJobRegistry
  memory: HomeChatMemoryStore
  skills: HomeChatSkills
  subagents: HomeChatSubagents
  routines: HomeChatRoutines
  attachments: HomeChatAttachments
  webConfig: () => HomeChatWebConfig
}
