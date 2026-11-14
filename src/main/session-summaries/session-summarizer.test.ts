import { describe, expect, it, vi } from 'vitest'
import type { UtilityModelRequest } from '../../shared/utility-model/utility-model-types'
import { SessionSummarizer } from './session-summarizer'
import { SessionSummaryCache } from './session-summary-cache'

const LONG_MESSAGE =
  'I traced the failing login redirect to the session cookie being dropped on the callback route, patched the middleware to preserve it, and added a regression test that covers the callback.'
const OTHER_MESSAGE =
  'The migration is ready but it will drop the legacy audit table, which still has rows from last year. Do you want me to archive them first or drop the table as planned?'

function harness(options: { enabled?: () => boolean } = {}) {
  const timers: { run: () => void; cancelled: boolean; delayMs: number }[] = []
  const calls: {
    request: UtilityModelRequest
    resolve: (text: string) => void
    reject: () => void
  }[] = []
  const changes: string[] = []
  const complete = vi.fn(
    (request: UtilityModelRequest) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ request, resolve, reject: () => reject(new Error('failed')) })
      })
  )
  const summarizer = new SessionSummarizer({
    complete,
    enabled: options.enabled ?? (() => true),
    cache: new SessionSummaryCache(null),
    onChange: (sessionKey) => changes.push(sessionKey),
    setTimer: (run, delayMs) => {
      const timer = { run, cancelled: false, delayMs }
      timers.push(timer)
      return { cancel: () => (timer.cancelled = true) }
    },
    now: () => 1_000
  })
  const fireTimers = () => {
    for (const timer of timers.splice(0)) {
      if (!timer.cancelled) {
        timer.run()
      }
    }
  }
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
  return { summarizer, complete, calls, changes, timers, fireTimers, settle }
}

describe('SessionSummarizer', () => {
  it('shows a pending summary, asks once after the debounce, then shows the cleaned reply', async () => {
    const h = harness()

    h.summarizer.request('s1', LONG_MESSAGE, false)
    expect(h.summarizer.view('s1')).toEqual({ text: null, pending: true })
    expect(h.complete).not.toHaveBeenCalled()

    h.fireTimers()
    expect(h.complete).toHaveBeenCalledTimes(1)
    h.calls[0].resolve('"Fixed the login redirect and added a regression test."\nExtra line')
    await h.settle()

    expect(h.summarizer.view('s1')).toEqual({
      text: 'Fixed the login redirect and added a regression test.',
      pending: false
    })
  })

  it('sends only the prepared message text, with code blocks removed', () => {
    const h = harness()

    h.summarizer.request(
      's1',
      `${LONG_MESSAGE}\n\`\`\`ts\nconst apiKey = "sk-live-123"\n\`\`\`\nAnything else?`,
      false
    )
    h.fireTimers()

    const sent = h.calls[0].request.messages.map((message) => message.content).join('\n')
    expect(sent).toContain('Anything else?')
    expect(sent).not.toContain('sk-live-123')
    expect(sent).not.toContain('```')
  })

  it('never summarizes the same message of a session twice', async () => {
    const h = harness()
    h.summarizer.request('s1', LONG_MESSAGE, false)
    h.fireTimers()
    h.calls[0].resolve('Fixed the login redirect.')
    await h.settle()

    h.summarizer.clear('s1')
    expect(h.summarizer.view('s1')).toBeNull()
    h.summarizer.request('s1', LONG_MESSAGE, false)
    h.fireTimers()

    expect(h.complete).toHaveBeenCalledTimes(1)
    expect(h.summarizer.view('s1')).toEqual({ text: 'Fixed the login redirect.', pending: false })
  })

  it('debounces: only the message standing when the timer fires is summarized', () => {
    const h = harness()

    h.summarizer.request('s1', LONG_MESSAGE, false)
    h.summarizer.request('s1', OTHER_MESSAGE, true)
    h.fireTimers()

    expect(h.complete).toHaveBeenCalledTimes(1)
    expect(h.calls[0].request.messages[1].content).toContain('archive them first')
  })

  it('keeps one request in flight per session and runs the newer message after it', async () => {
    const h = harness()
    h.summarizer.request('s1', LONG_MESSAGE, false)
    h.fireTimers()

    h.summarizer.request('s1', OTHER_MESSAGE, true)
    h.fireTimers()
    expect(h.complete).toHaveBeenCalledTimes(1)

    h.calls[0].resolve('Fixed the login redirect.')
    await h.settle()
    expect(h.complete).toHaveBeenCalledTimes(2)
    expect(h.summarizer.view('s1')).toEqual({ text: null, pending: true })

    h.calls[1].resolve('Needs a decision: archive audit rows or drop the table.')
    await h.settle()
    expect(h.summarizer.view('s1')).toEqual({
      text: 'Needs a decision: archive audit rows or drop the table.',
      pending: false
    })
  })

  it('runs separate sessions side by side', () => {
    const h = harness()

    h.summarizer.request('s1', LONG_MESSAGE, false)
    h.summarizer.request('s2', OTHER_MESSAGE, true)
    h.fireTimers()

    expect(h.complete).toHaveBeenCalledTimes(2)
  })

  it('uses a message that already fits as its own summary without a request', () => {
    const h = harness()

    h.summarizer.request('s1', 'All tests pass.', false)
    h.fireTimers()

    expect(h.complete).not.toHaveBeenCalled()
    expect(h.summarizer.view('s1')).toEqual({ text: 'All tests pass.', pending: false })
  })

  it('asks for nothing while unavailable and makes up for it once the model is back', async () => {
    let enabled = false
    const h = harness({ enabled: () => enabled })

    h.summarizer.request('s1', LONG_MESSAGE, false)
    h.fireTimers()
    expect(h.complete).not.toHaveBeenCalled()
    expect(h.summarizer.view('s1')).toEqual({ text: null, pending: false })

    enabled = true
    h.summarizer.retryFailed()
    h.fireTimers()
    h.calls[0].resolve('Fixed the login redirect.')
    await h.settle()

    expect(h.summarizer.view('s1')).toEqual({ text: 'Fixed the login redirect.', pending: false })
  })

  it('stops showing pending when the request fails', async () => {
    const h = harness()
    h.summarizer.request('s1', LONG_MESSAGE, false)
    h.fireTimers()

    h.calls[0].reject()
    await h.settle()

    expect(h.summarizer.view('s1')).toEqual({ text: null, pending: false })
  })
})
