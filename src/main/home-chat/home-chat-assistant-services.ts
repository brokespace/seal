import type { HomeChatOpenTarget } from '../../shared/home-chat/home-chat-types'
import type { HomeChatAttachments } from './attachments/home-chat-attachments'
import type { HomeChatSubagents } from './delegation/home-chat-subagents'
import type { HomeChatJobRegistry } from './jobs/home-chat-job-registry'
import type { HomeChatMemoryStore } from './memory/home-chat-memory-store'
import type { HomeChatRoutines } from './routines/home-chat-routines'
import type { HomeChatAccountAccess } from './seal/home-chat-account-access'
import type { HomeChatSessionAccess } from './seal/home-chat-session-access'
import type { HomeChatSkills } from './skills/home-chat-skills'
import type { HomeChatWebConfig } from './web/home-chat-web'

/** What Seal itself manages, as the assistant reaches it. */
export type HomeChatSealAccess = {
  sessions: HomeChatSessionAccess
  accounts: HomeChatAccountAccess
  /** Ask the Seal window to show something. */
  open: (target: HomeChatOpenTarget) => void
}

/** Long-lived assistant services shared by every chat. */
export type HomeChatAssistantServices = {
  jobs: HomeChatJobRegistry
  memory: HomeChatMemoryStore
  skills: HomeChatSkills
  subagents: HomeChatSubagents
  routines: HomeChatRoutines
  attachments: HomeChatAttachments
  seal: HomeChatSealAccess
  webConfig: () => HomeChatWebConfig
}
