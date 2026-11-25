import { randomUUID } from 'node:crypto'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecord } from '../home-chat-record-guard'
import type { HomeChatThreadItem, HomeChatThreadItemBody } from './home-chat-thread-items'

type Rec = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function legacyEntryItems(entry: Rec, ord: number): HomeChatThreadItemBody[] {
  const id = text(entry.id) || randomUUID()
  switch (entry.kind) {
    case 'user':
      return [{ type: 'user', ord, text: text(entry.text), origin: 'user' }]
    case 'notice':
      return [{ type: 'user', ord, text: text(entry.text), origin: 'notice' }]
    case 'assistant':
    case 'thinking':
      return text(entry.text).trim()
        ? [
            {
              type: 'assistant',
              stop: 'end',
              parts: [
                {
                  id,
                  ord,
                  kind: entry.kind === 'assistant' ? 'text' : 'thinking',
                  text: text(entry.text)
                }
              ]
            }
          ]
        : []
    case 'tool': {
      const settled = entry.status === 'ok' || entry.status === 'error' || entry.status === 'denied'
      const call: HomeChatThreadItemBody = {
        type: 'assistant',
        stop: 'tool_calls',
        parts: [
          {
            id,
            ord,
            kind: 'tool_call',
            callId: id,
            tool: text(entry.tool),
            input: isRecord(entry.input) ? entry.input : {}
          }
        ]
      }
      return settled
        ? [
            call,
            {
              type: 'tool_result',
              callId: id,
              tool: text(entry.tool),
              content: text(entry.output),
              outcome:
                entry.status === 'ok' ? 'ok' : entry.status === 'denied' ? 'denied' : 'error',
              ...(text(entry.machine) ? { machine: text(entry.machine) } : {})
            }
          ]
        : [call]
    }
    case 'progress':
    case 'error':
      return [{ type: 'event', ord, event: { kind: entry.kind, text: text(entry.text) } }]
    case 'attachment':
      return [
        {
          type: 'event',
          ord,
          event: {
            kind: 'attachment',
            attachmentId: text(entry.attachmentId),
            name: text(entry.name),
            mimeType: text(entry.mimeType),
            size: typeof entry.size === 'number' ? entry.size : 0
          }
        }
      ]
    default:
      return []
  }
}

/** One earlier-format chat as thread items; ids and order are kept. */
export function legacyChatItems(entries: readonly unknown[]): HomeChatThreadItem[] {
  const items: HomeChatThreadItem[] = []
  entries.filter(isRecord).forEach((entry, index) => {
    for (const body of legacyEntryItems(entry, index + 1)) {
      const reuseId = body.type === 'user' || body.type === 'event'
      items.push({
        ...body,
        seq: items.length + 1,
        id: reuseId && text(entry.id) ? text(entry.id) : randomUUID(),
        at: typeof entry.at === 'number' ? entry.at : Date.now()
      })
    }
  })
  return items
}

/**
 * Chats saved by the first assistant (one JSON file each) become threads once.
 * Provider sessions are not carried over: the next message replays the thread to a fresh one.
 */
export async function importLegacyHomeChats(legacyDir: string, threadsDir: string): Promise<void> {
  const files = await readdir(legacyDir).catch(() => [])
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const path = join(legacyDir, file)
    const stored: unknown = await readFile(path, 'utf8')
      .then((raw): unknown => JSON.parse(raw))
      .catch(() => null)
    const chat = isRecord(stored) && isRecord(stored.chat) ? stored.chat : null
    if (!chat || typeof chat.id !== 'string' || !Array.isArray(chat.entries)) {
      continue
    }
    const id = chat.id.replace(/[^a-zA-Z0-9-]/g, '')
    const { entries: _entries, status: _status, ...meta } = chat
    const lines = legacyChatItems(chat.entries).map((item) => JSON.stringify(item))
    await writeFile(join(threadsDir, `${id}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '')
    await writeFile(join(threadsDir, `${id}.meta.json`), JSON.stringify(meta, null, 2))
    await rename(path, `${path}.imported`)
  }
}
