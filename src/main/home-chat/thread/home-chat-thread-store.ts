import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HOME_CHAT_BACKEND_KINDS,
  type HomeChatBackendKind
} from '../../../shared/home-chat/home-chat-types'
import { isRecord } from '../home-chat-record-guard'
import { importLegacyHomeChats } from './home-chat-legacy-chat-import'
import { HomeChatThread, type HomeChatThreadMeta } from './home-chat-thread'
import type { HomeChatThreadItem } from './home-chat-thread-items'

const ITEM_TYPES = new Set(['user', 'assistant', 'tool_result', 'compaction', 'event'])

function isItem(value: unknown): value is HomeChatThreadItem {
  return (
    isRecord(value) &&
    typeof value.seq === 'number' &&
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    ITEM_TYPES.has(value.type)
  )
}

/** A torn last line (crash mid-append) or a repeated seq is dropped; the rest of the log stands. */
export function parseThreadLog(text: string): HomeChatThreadItem[] {
  const bySeq = new Map<number, HomeChatThreadItem>()
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (isItem(parsed) && !bySeq.has(parsed.seq)) {
      bySeq.set(parsed.seq, parsed)
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

function parseMeta(value: unknown): HomeChatThreadMeta | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null
  }
  const backend = HOME_CHAT_BACKEND_KINDS.find((kind) => kind === value.backend) ?? 'claude-code'
  const session = isRecord(value.providerSession) ? value.providerSession : null
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : 'New chat',
    ...(typeof value.parentChatId === 'string' ? { parentChatId: value.parentChatId } : {}),
    backend,
    accountId: typeof value.accountId === 'string' ? value.accountId : null,
    model: typeof value.model === 'string' ? value.model : null,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    ...(session &&
    (session.backend === 'claude-code' || session.backend === 'codex') &&
    typeof session.sessionId === 'string' &&
    typeof session.throughSeq === 'number'
      ? {
          providerSession: {
            backend: session.backend,
            accountId: typeof session.accountId === 'string' ? session.accountId : null,
            sessionId: session.sessionId,
            throughSeq: session.throughSeq
          }
        }
      : {}),
    ...(typeof value.contextTokens === 'number' ? { contextTokens: value.contextTokens } : {}),
    ...(typeof value.tokenRatio === 'number' ? { tokenRatio: value.tokenRatio } : {}),
    ...(typeof value.lastMachine === 'string' ? { lastMachine: value.lastMachine } : {})
  }
}

// Ids are main-generated UUIDs; strip anything else so a crafted id cannot escape the folder.
const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9-]/g, '')

/** Every thread: an append-only `<id>.jsonl` log beside a small `<id>.meta.json`. */
export class HomeChatThreadStore {
  private readonly threads = new Map<string, HomeChatThread>()

  private constructor(private readonly dir: string) {}

  static async open(rootDir: string): Promise<HomeChatThreadStore> {
    const store = new HomeChatThreadStore(join(rootDir, 'threads'))
    await mkdir(store.dir, { recursive: true })
    await importLegacyHomeChats(join(rootDir, 'chats'), store.dir).catch((error: unknown) => {
      console.error('[home-chat] could not import earlier chats', error)
    })
    for (const file of await readdir(store.dir)) {
      if (!file.endsWith('.meta.json')) {
        continue
      }
      const meta = parseMeta(
        await readFile(join(store.dir, file), 'utf8')
          .then((text): unknown => JSON.parse(text))
          .catch(() => null)
      )
      if (!meta || safeId(meta.id) !== file.slice(0, -'.meta.json'.length)) {
        continue
      }
      const paths = store.paths(meta.id)
      const items = parseThreadLog(await readFile(paths.log, 'utf8').catch(() => ''))
      store.threads.set(meta.id, new HomeChatThread(meta, items, paths))
    }
    return store
  }

  list(): HomeChatThread[] {
    return [...this.threads.values()].sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
  }

  get(threadId: string): HomeChatThread | undefined {
    return this.threads.get(threadId)
  }

  create(args: {
    backend: HomeChatBackendKind
    accountId: string | null
    model: string | null
    parentChatId?: string
    title?: string
  }): HomeChatThread {
    const now = Date.now()
    const meta: HomeChatThreadMeta = {
      id: randomUUID(),
      title: args.title ?? 'New chat',
      ...(args.parentChatId ? { parentChatId: args.parentChatId } : {}),
      backend: args.backend,
      accountId: args.accountId,
      model: args.model,
      createdAt: now,
      updatedAt: now
    }
    const thread = new HomeChatThread(meta, [], this.paths(meta.id))
    this.threads.set(meta.id, thread)
    thread.saveMeta()
    return thread
  }

  async delete(threadId: string): Promise<void> {
    const thread = this.threads.get(threadId)
    this.threads.delete(threadId)
    await thread?.discard()
    const paths = this.paths(threadId)
    await Promise.all([rm(paths.log, { force: true }), rm(paths.meta, { force: true })])
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.threads.values()].map((thread) => thread.flush()))
  }

  private paths(threadId: string): { log: string; meta: string } {
    const id = safeId(threadId)
    return { log: join(this.dir, `${id}.jsonl`), meta: join(this.dir, `${id}.meta.json`) }
  }
}
