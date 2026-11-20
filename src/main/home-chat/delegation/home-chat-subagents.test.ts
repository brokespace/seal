import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HomeChatSubagents,
  type HomeChatSubagent,
  type HomeChatWorkerHost
} from './home-chat-subagents'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'home-chat-subagents-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function fakeWorkers(): HomeChatWorkerHost & { sent: [string, string][]; answer: string } {
  const sent: [string, string][] = []
  const host = {
    sent,
    answer: '',
    create: (parentChatId: string) => `worker-of-${parentChatId}`,
    send: (workerChatId: string, text: string) => {
      host.sent.push([workerChatId, text])
    },
    stop: () => undefined,
    isRunning: () => false,
    lastAnswer: () => host.answer
  }
  return host
}

describe('HomeChatSubagents assistant workers', () => {
  it('briefs a worker chat and revives the parent with its final answer', () => {
    const workers = fakeWorkers()
    const settled: HomeChatSubagent[] = []
    const subagents = new HomeChatSubagents({
      rootDir: root,
      runOrcaCli: () => Promise.reject(new Error('unused')),
      workers,
      onSettled: (item) => settled.push({ ...item })
    })

    const item = subagents.spawnAssistant({
      chatId: 'parent',
      task: 'Find the largest log on tower',
      title: 'Logs'
    })
    expect(workers.sent).toHaveLength(1)
    expect(workers.sent[0][0]).toBe('worker-of-parent')
    expect(workers.sent[0][1]).toContain('<task>\nFind the largest log on tower\n</task>')

    workers.answer = '/var/log/syslog, 2.1 GB'
    subagents.workerTurnEnded('worker-of-parent', false)

    expect(settled).toEqual([
      expect.objectContaining({
        id: item.id,
        chatId: 'parent',
        state: 'idle',
        result: '/var/log/syslog, 2.1 GB'
      })
    ])
  })

  it('reports a failed worker turn as failed', () => {
    const settled: HomeChatSubagent[] = []
    const subagents = new HomeChatSubagents({
      rootDir: root,
      runOrcaCli: () => Promise.reject(new Error('unused')),
      workers: fakeWorkers(),
      onSettled: (item) => settled.push({ ...item })
    })
    subagents.spawnAssistant({ chatId: 'parent', task: 't', title: 'T' })
    subagents.workerTurnEnded('worker-of-parent', true)
    expect(settled.map((item) => item.state)).toEqual(['failed'])
  })
})
