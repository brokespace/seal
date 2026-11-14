import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HomeChatRoutines, type HomeChatRoutine } from './home-chat-routines'

let root: string
let routines: HomeChatRoutines | null

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'home-chat-routines-'))
  routines = null
})

afterEach(async () => {
  routines?.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('HomeChatRoutines', () => {
  it('fires a due routine into its chat and schedules the next run', () => {
    let now = new Date(2026, 0, 5, 8, 0).getTime()
    const fired: HomeChatRoutine[] = []
    routines = new HomeChatRoutines({
      rootDir: root,
      onFire: (r) => fired.push({ ...r }),
      now: () => now
    })
    const routine = routines.create({
      chatId: 'c1',
      name: 'Morning check',
      schedule: '30 9 * * *',
      prompt: 'Check disk space on tower'
    })
    expect(routine.nextRunAt).toBe(new Date(2026, 0, 5, 9, 30).getTime())

    now = new Date(2026, 0, 5, 9, 31).getTime()
    routines.tick()

    expect(fired.map((r) => [r.chatId, r.prompt])).toEqual([['c1', 'Check disk space on tower']])
    expect(routines.list('c1')[0].nextRunAt).toBe(new Date(2026, 0, 6, 9, 30).getTime())
  })

  it('disables a one-off routine after it fires', () => {
    let now = new Date(2026, 0, 5, 8, 0).getTime()
    let fired = 0
    routines = new HomeChatRoutines({ rootDir: root, onFire: () => fired++, now: () => now })
    routines.create({ chatId: 'c1', name: 'Once', schedule: '0 9 * * *', prompt: 'p', once: true })

    now = new Date(2026, 0, 5, 9, 1).getTime()
    routines.tick()
    now = new Date(2026, 0, 6, 9, 1).getTime()
    routines.tick()

    expect(fired).toBe(1)
    expect(routines.list('c1')[0]).toMatchObject({ enabled: false, nextRunAt: null })
  })

  it('rejects a schedule the cron engine cannot parse', () => {
    routines = new HomeChatRoutines({ rootDir: root, onFire: () => undefined })
    expect(() =>
      routines?.create({ chatId: 'c1', name: 'Bad', schedule: 'every tuesday', prompt: 'p' })
    ).toThrow()
  })
})
