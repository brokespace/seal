// What the assistant remembers across chats; the user can edit all of it.

export type HomeChatMemoryItem = {
  id: string
  text: string
  /** Epoch ms when it was written. */
  at: number
}

export type HomeChatMachineOs = 'linux' | 'macos' | 'windows'

export type HomeChatMachineNote = {
  /** Machine id (`local`, `ssh:<id>`) or a machine reached through another (`hop:<name>`). */
  machine: string
  notes: string
  os?: HomeChatMachineOs
  /** Reach this machine by running ssh on another machine (that machine's id); needs host. */
  via?: string
  host?: string
  user?: string
  port?: number
}

export type HomeChatMemory = {
  /** Standing instructions that apply to every task. */
  rules: HomeChatMemoryItem[]
  /** Facts about the user and their machines: hostnames, what runs where, which repos live where. */
  facts: HomeChatMemoryItem[]
  machines: HomeChatMachineNote[]
  /** Dated log of what the assistant did, oldest first. */
  journal: HomeChatMemoryItem[]
}

export type HomeChatMemoryKind = 'rule' | 'fact' | 'journal'
