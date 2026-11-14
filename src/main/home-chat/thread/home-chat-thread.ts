import { randomUUID } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import type {
  HomeChatBackendKind,
  HomeChatEntry,
  HomeChatStatus
} from '../../../shared/home-chat/home-chat-types'
import { mergeHomeChatEntry } from '../../../shared/home-chat/home-chat-entry-merge'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { projectHomeChatEntries } from './home-chat-entry-projection'
import type {
  HomeChatProviderSession,
  HomeChatThreadItem,
  HomeChatThreadItemBody
} from './home-chat-thread-items'

const META_SAVE_DELAY_MS = 250

export type HomeChatThreadMeta = {
  id: string
  title: string
  /** Set on background worker threads spawned by another thread. */
  parentChatId?: string
  backend: HomeChatBackendKind
  accountId: string | null
  model: string | null
  createdAt: number
  updatedAt: number
  providerSession?: HomeChatProviderSession
  /** Context size the provider last reported for this thread, in tokens. */
  contextTokens?: number
  /** Measured tokens per estimated token, learned from the provider's own counts. */
  tokenRatio?: number
  /** Context use as of the last turn, for the thread's context meter. */
  contextUsed?: number
  contextWindow?: number
  lastMachine?: string
}

function maxOrd(items: readonly HomeChatThreadItem[]): number {
  let max = 0
  for (const item of items) {
    if (item.type === 'assistant') {
      for (const part of item.parts) {
        max = Math.max(max, part.ord)
      }
    } else if (item.type !== 'tool_result') {
      max = Math.max(max, item.ord)
    }
  }
  return max
}

/**
 * One conversation. Items are appended to disk the moment they exist, so a crash loses at most the
 * round being streamed; entries are the live view of the same items plus whatever is still streaming.
 */
export class HomeChatThread {
  status: HomeChatStatus = 'idle'
  private entryList: HomeChatEntry[]
  private ord: number
  private seq: number
  private writes: Promise<void> = Promise.resolve()
  private metaTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private metaValue: HomeChatThreadMeta,
    private readonly itemList: HomeChatThreadItem[],
    private readonly paths: { log: string; meta: string }
  ) {
    this.entryList = projectHomeChatEntries(itemList)
    this.ord = maxOrd(itemList)
    this.seq = itemList.at(-1)?.seq ?? 0
  }

  get id(): string {
    return this.metaValue.id
  }

  get meta(): HomeChatThreadMeta {
    return this.metaValue
  }

  get items(): readonly HomeChatThreadItem[] {
    return this.itemList
  }

  get entries(): readonly HomeChatEntry[] {
    return this.entryList
  }

  get lastSeq(): number {
    return this.seq
  }

  nextOrd(): number {
    this.ord += 1
    return this.ord
  }

  append(body: HomeChatThreadItemBody, id: string = randomUUID()): HomeChatThreadItem {
    this.seq += 1
    const item: HomeChatThreadItem = { ...body, seq: this.seq, id, at: Date.now() }
    this.itemList.push(item)
    const line = `${JSON.stringify(item)}\n`
    this.writes = this.writes
      .then(() => appendFile(this.paths.log, line, 'utf8'))
      .catch((error: unknown) => {
        console.error('[home-chat] could not append to the thread log', error)
      })
    this.updateMeta({})
    return item
  }

  /** Keep the live view current; an older revision never replaces a newer one. */
  upsertEntry(entry: HomeChatEntry): void {
    const known = this.entryList.some((existing) => existing.id === entry.id)
    this.entryList = mergeHomeChatEntry(this.entryList, entry)
    if (!known) {
      this.entryList.sort((a, b) => a.ord - b.ord)
    }
  }

  /** Drop live-only state: what remains is exactly what a restart would show. */
  resetEntriesFromLog(): void {
    this.entryList = projectHomeChatEntries(this.itemList)
  }

  updateMeta(patch: Partial<HomeChatThreadMeta>): void {
    this.metaValue = { ...this.metaValue, ...patch, updatedAt: Date.now() }
    this.metaTimer ??= setTimeout(() => this.saveMeta(), META_SAVE_DELAY_MS)
  }

  saveMeta(): void {
    if (this.metaTimer) {
      clearTimeout(this.metaTimer)
      this.metaTimer = null
    }
    try {
      writeFileAtomically(this.paths.meta, JSON.stringify(this.metaValue, null, 2))
    } catch (error) {
      console.error('[home-chat] could not save thread metadata', error)
    }
  }

  /** Resolves once every appended item is on disk. */
  async flush(): Promise<void> {
    this.saveMeta()
    await this.writes
  }

  /** Stop pending writes for a thread that is being deleted. */
  discard(): Promise<void> {
    if (this.metaTimer) {
      clearTimeout(this.metaTimer)
      this.metaTimer = null
    }
    return this.writes
  }
}
