import { describe, expect, it } from 'vitest'
import {
  readTranscriptForward,
  readTranscriptPage,
  type TranscriptSource
} from './live-transcript-reader'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'

const user = (text: string) =>
  JSON.stringify({ type: 'user', uuid: text, message: { role: 'user', content: text } })

function memorySource(initial: string, maxRead = 1024): TranscriptSource & { text: string } {
  const source = {
    text: initial,
    maxRead,
    async read(start: number, length: number) {
      const all = Buffer.from(source.text)
      return { bytes: all.subarray(start, start + length), size: all.length }
    }
  }
  return source
}

const texts = (messages: NativeChatMessage[]) =>
  messages.map((m) => (m.blocks[0]?.type === 'text' ? m.blocks[0].text : null))

describe('live transcript reading', () => {
  it('pages backwards with byte offsets as stable ids', async () => {
    const lines = ['one', 'two', 'three', 'four'].map(user)
    const source = memorySource(`${lines.join('\n')}\n`)
    const last = await readTranscriptPage(source, 'claude', 's', null, 2)
    expect(texts(last.messages)).toEqual(['three', 'four'])
    expect(last.more).toBe(true)
    const offsetOfThree = lines[0].length + lines[1].length + 2
    expect(last.messages[0].id).toBe(`o${offsetOfThree}`)

    const earlier = await readTranscriptPage(source, 'claude', 's', last.start, 2)
    expect(texts(earlier.messages)).toEqual(['one', 'two'])
    expect(earlier.more).toBe(false)
  })

  it('reads forward only whole lines, so a half-written record is picked up next time', async () => {
    const source = memorySource(`${user('one')}\n${user('two').slice(0, 10)}`)
    const first = await readTranscriptForward(source, 'claude', 0)
    expect(texts(first.messages)).toEqual(['one'])
    expect(first.cursor).toBe(user('one').length + 1)

    source.text = `${user('one')}\n${user('two')}\n`
    const second = await readTranscriptForward(source, 'claude', first.cursor)
    expect(texts(second.messages)).toEqual(['two'])
    expect(second.cursor).toBe(source.text.length)
    expect(second.shrank).toBe(false)

    source.text = `${user('new')}\n`
    expect((await readTranscriptForward(source, 'claude', second.cursor)).shrank).toBe(true)
  })
})
