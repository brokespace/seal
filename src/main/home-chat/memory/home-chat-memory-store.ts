import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { isRecord } from '../home-chat-record-guard'
import type {
  HomeChatMachineNote,
  HomeChatMemory,
  HomeChatMemoryItem,
  HomeChatMemoryKind
} from '../../../shared/home-chat/home-chat-memory-types'

const MAX_JOURNAL_ENTRIES = 500
const MAX_ITEM_CHARS = 2_000

const SECTION: Record<HomeChatMemoryKind, 'rules' | 'facts' | 'journal'> = {
  rule: 'rules',
  fact: 'facts',
  journal: 'journal'
}

export type HomeChatMachineNotePatch = Partial<Omit<HomeChatMachineNote, 'machine'>> & {
  machine: string
  remove?: boolean
}

function emptyMemory(): HomeChatMemory {
  return { rules: [], facts: [], machines: [], journal: [] }
}

function parseItems(value: unknown): HomeChatMemoryItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): HomeChatMemoryItem[] =>
    isRecord(item) && typeof item.text === 'string' && item.text.trim()
      ? [
          {
            id: typeof item.id === 'string' ? item.id : randomUUID().slice(0, 8),
            text: item.text.trim().slice(0, MAX_ITEM_CHARS),
            at: typeof item.at === 'number' ? item.at : Date.now()
          }
        ]
      : []
  )
}

function parseMachineNotes(value: unknown): HomeChatMachineNote[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((note): HomeChatMachineNote[] => {
    if (!isRecord(note) || typeof note.machine !== 'string' || !note.machine.trim()) {
      return []
    }
    const os =
      note.os === 'linux' || note.os === 'macos' || note.os === 'windows' ? note.os : undefined
    const text = (key: string): string | undefined =>
      typeof note[key] === 'string' && note[key].trim() ? note[key].trim() : undefined
    const port =
      typeof note.port === 'number' && Number.isInteger(note.port) ? note.port : undefined
    return [
      {
        machine: note.machine.trim(),
        notes: text('notes') ?? '',
        ...(os ? { os } : {}),
        ...(text('via') ? { via: text('via') } : {}),
        ...(text('host') ? { host: text('host') } : {}),
        ...(text('user') ? { user: text('user') } : {}),
        ...(port ? { port } : {})
      }
    ]
  })
}

export function parseHomeChatMemory(value: unknown): HomeChatMemory {
  if (!isRecord(value)) {
    return emptyMemory()
  }
  return {
    rules: parseItems(value.rules),
    facts: parseItems(value.facts),
    machines: parseMachineNotes(value.machines),
    journal: parseItems(value.journal).slice(-MAX_JOURNAL_ENTRIES)
  }
}

/** One JSON file the assistant reads every turn and the user edits in the memory panel. */
export class HomeChatMemoryStore {
  private memory: HomeChatMemory = emptyMemory()
  private readonly path: string

  constructor(
    rootDir: string,
    private readonly onChange: () => void = () => {}
  ) {
    this.path = join(rootDir, 'memory.json')
  }

  async load(): Promise<void> {
    const raw: unknown = await readFile(this.path, 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => null)
    this.memory = parseHomeChatMemory(raw)
  }

  get(): HomeChatMemory {
    return this.memory
  }

  machineNotes(): HomeChatMachineNote[] {
    return this.memory.machines
  }

  remember(kind: HomeChatMemoryKind, text: string): HomeChatMemoryItem {
    const section = SECTION[kind]
    const trimmed = text.trim().slice(0, MAX_ITEM_CHARS)
    if (!trimmed) {
      throw new Error('Nothing to remember.')
    }
    const existing = this.memory[section].find(
      (item) => item.text.toLowerCase() === trimmed.toLowerCase()
    )
    if (existing && kind !== 'journal') {
      return existing
    }
    const item = { id: randomUUID().slice(0, 8), text: trimmed, at: Date.now() }
    const items = [...this.memory[section], item]
    this.write({
      ...this.memory,
      [section]: kind === 'journal' ? items.slice(-MAX_JOURNAL_ENTRIES) : items
    })
    return item
  }

  /** Remove one rule, fact or journal entry by id, or by text that matches exactly one item. */
  forget(query: string): HomeChatMemoryItem {
    const wanted = query.trim().toLowerCase()
    const all = (['rules', 'facts', 'journal'] as const).flatMap((section) =>
      this.memory[section].map((item) => ({ section, item }))
    )
    const byId = all.filter(({ item }) => item.id.toLowerCase() === wanted)
    const matches = byId.length
      ? byId
      : all.filter(({ item }) => item.text.toLowerCase().includes(wanted))
    if (!wanted || matches.length === 0) {
      throw new Error(`Nothing in memory matches "${query}".`)
    }
    if (matches.length > 1) {
      const options = matches.map(({ item }) => `${item.id}: ${item.text.slice(0, 80)}`).join('\n')
      throw new Error(`"${query}" matches several memories; forget one by id:\n${options}`)
    }
    const [{ section, item }] = matches
    this.write({ ...this.memory, [section]: this.memory[section].filter((i) => i.id !== item.id) })
    return item
  }

  configureMachine(patch: HomeChatMachineNotePatch): HomeChatMachineNote | null {
    const others = this.memory.machines.filter((note) => note.machine !== patch.machine)
    if (patch.remove) {
      this.write({ ...this.memory, machines: others })
      return null
    }
    const current = this.memory.machines.find((note) => note.machine === patch.machine)
    const { remove: _remove, ...fields } = patch
    const [next] = parseMachineNotes([{ ...current, ...fields }])
    if (!next) {
      throw new Error('A machine note needs a machine id.')
    }
    this.write({ ...this.memory, machines: [...others, next] })
    return next
  }

  /** The user's edit from the memory panel replaces everything. */
  replace(memory: unknown): HomeChatMemory {
    this.write(parseHomeChatMemory(memory))
    return this.memory
  }

  private write(next: HomeChatMemory): void {
    this.memory = next
    writeFileAtomically(this.path, JSON.stringify(next, null, 2))
    this.onChange()
  }
}
