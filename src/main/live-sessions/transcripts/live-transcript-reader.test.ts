import { describe, expect, it } from 'vitest'
import { readTranscriptForward, readTranscriptPage } from './live-transcript-reader'
import {
  localTranscriptSource,
  remoteTranscriptSource,
  type TranscriptSource
} from './transcript-file-source'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLocalScript } from '../hosts/local-shell-script'
import type { LiveSessionHost } from '../hosts/live-session-hosts'

const user = (text: string) =>
  JSON.stringify({ type: 'user', uuid: text, message: { role: 'user', content: text } })

const texts = (messages: NativeChatMessage[]) =>
  messages.map((m) => (m.blocks[0]?.type === 'text' ? m.blocks[0].text : null))

/** A host that is only a shell, counting the scripts it ran and the bytes they sent back. */
function shellHost(): LiveSessionHost & { runs: number; bytes: number } {
  const host = {
    machine: { hostId: 'm1', label: 'm1', kind: 'remote' as const, connection: 'ssh' as const },
    runs: 0,
    bytes: 0,
    async run(script: string) {
      const out = await runLocalScript(script)
      host.runs++
      host.bytes += out.length
      return out
    }
  }
  return host
}

const PNG = Buffer.alloc(900 * 1024, 7).toString('base64')

/** A queued prompt with an inline image, then a pasted screenshot Claude also names by path. */
const IMAGE_RECORDS = [
  user('before'),
  JSON.stringify({
    type: 'attachment',
    uuid: 'queued',
    attachment: {
      type: 'queued_command',
      commandMode: 'prompt',
      prompt: [
        { type: 'text', text: 'compare' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }
      ]
    }
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'pasted',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }
      ]
    }
  }),
  user('after')
]

describe.each([
  ['a local file', (path: string) => localTranscriptSource(path)],
  ['a host that is only a shell', (path: string) => remoteTranscriptSource(shellHost(), path)]
])('reading a transcript from %s', (_name, sourceOf) => {
  async function withFile<T>(text: string, read: (source: TranscriptSource, path: string) => T) {
    const dir = await mkdtemp(join(tmpdir(), 'seal-transcript-'))
    try {
      const path = join(dir, 't.jsonl')
      await writeFile(path, text)
      return await read(sourceOf(path), path)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('pages backwards with byte offsets as stable ids', async () => {
    const lines = ['one', 'two', 'three', 'four'].map(user)
    await withFile(`${lines.join('\n')}\n`, async (source) => {
      const last = await readTranscriptPage(source, 'claude', 's', null, 2)
      expect(texts(last.messages)).toEqual(['three', 'four'])
      expect(last.more).toBe(true)
      const offsetOfThree = lines[0].length + lines[1].length + 2
      expect(last.messages[0].id).toBe(`o${offsetOfThree}`)

      const earlier = await readTranscriptPage(source, 'claude', 's', last.start, 2)
      expect(texts(earlier.messages)).toEqual(['one', 'two'])
      expect(earlier.more).toBe(false)
    })
  })

  it('reads forward only whole lines, so a half-written record is picked up next time', async () => {
    await withFile(`${user('one')}\n${user('two').slice(0, 10)}`, async (source, path) => {
      const page = await readTranscriptPage(source, 'claude', 's', null, 10)
      expect(page.cursor).toBe(user('one').length + 1)
      const first = await readTranscriptForward(source, 'claude', 0)
      expect(texts(first.messages)).toEqual(['one'])
      expect(first.cursor).toBe(user('one').length + 1)

      await writeFile(path, `${user('one')}\n${user('two')}\n`)
      const second = await readTranscriptForward(source, 'claude', first.cursor)
      expect(texts(second.messages)).toEqual(['two'])
      expect(second.cursor).toBe(`${user('one')}\n${user('two')}\n`.length)
      expect(second.shrank).toBe(false)

      await writeFile(path, `${user('new')}\n`)
      expect((await readTranscriptForward(source, 'claude', second.cursor)).shrank).toBe(true)
    })
  })

  it('keeps the rows of records that carry megabytes of image, and names the image by its place in the file', async () => {
    const text = `${IMAGE_RECORDS.join('\n')}\n`
    await withFile(text, async (source) => {
      const page = await readTranscriptPage(source, 'claude', 's', null, 10)
      expect(page.messages.map((m) => m.blocks.map((b) => b.type))).toEqual([
        ['text'],
        ['text', 'image-ref'],
        ['text'],
        ['text']
      ])
      const start = text.indexOf(PNG)
      const image = page.messages[1].blocks[1]
      expect(image).toEqual({
        type: 'image-ref',
        url: `seal-transcript-image:${start}+${PNG.length};image/png`
      })
      expect(await source.base64Run(start, PNG.length)).toBe(PNG)

      const forward: NativeChatMessage[] = []
      let cursor = 0
      while (cursor < text.length) {
        const read = await readTranscriptForward(source, 'claude', cursor)
        forward.push(...read.messages)
        cursor = read.cursor
      }
      expect(forward).toEqual(page.messages)
    })
  })
})

describe('reading a transcript from a host that is only a shell', () => {
  it('reads an image-heavy page in one round trip without the image bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seal-transcript-'))
    try {
      const path = join(dir, 't.jsonl')
      const records = Array.from({ length: 6 }, () => IMAGE_RECORDS).flat()
      await writeFile(path, `${records.join('\n')}\n`)
      const host = shellHost()
      const page = await readTranscriptPage(
        remoteTranscriptSource(host, path),
        'claude',
        's',
        null,
        20
      )
      expect(page.messages).toHaveLength(20)
      expect(host.runs).toBe(1)
      expect(host.bytes).toBeLessThan(16 * 1024)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
