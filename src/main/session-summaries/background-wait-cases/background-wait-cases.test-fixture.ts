// The labelled cases the judge of background waits is measured on: what a Claude Code turn left
// running when it ended, as the app would read it, and whether the agent waits on it. Each was
// labelled from the case alone, before any model saw it. See docs/design/agent-status.md.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as z from 'zod'
import { LIVE_SUBAGENT_STATUSES } from '../../../shared/live-sessions/live-session-activity'
import {
  waitsOnFinalTurnCommand,
  type BackgroundWaitEvidence
} from '../../../shared/live-sessions/live-session-background-wait'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { BACKGROUND_WAIT_STANDINGS } from '../background-wait-judge'

/** The wording and the cut are tuned on `tune`; a number is only a result on `held-out`. */
export const BACKGROUND_WAIT_SPLITS = ['tune', 'held-out'] as const
export type BackgroundWaitSplit = (typeof BACKGROUND_WAIT_SPLITS)[number]

const caseSchema = z.strictObject({
  id: z.string().min(1),
  truth: z.enum(BACKGROUND_WAIT_STANDINGS),
  /** What in the case decides its label. */
  why: z.string().min(1),
  /** How long ago the turn ended when the session is looked at. */
  endedAgoSeconds: z.number().positive(),
  reply: z.string().min(1).nullable(),
  registry: z.string().min(1).nullable(),
  commands: z.array(
    z.strictObject({
      kind: z.enum(['shell', 'monitor']),
      turn: z.enum(['final', 'earlier']).nullable(),
      startedBeforeEndSeconds: z.number().positive().nullable(),
      description: z.string().min(1).nullable(),
      command: z.string().min(1).nullable(),
      state: z.enum(LIVE_SUBAGENT_STATUSES),
      runs: z.array(z.string().min(1)).nullable()
    })
  )
})

export type BackgroundWaitCase = z.infer<typeof caseSchema> & { split: BackgroundWaitSplit }

const FIXTURES = join(import.meta.dirname, '__fixtures__')

export async function loadBackgroundWaitCases(): Promise<BackgroundWaitCase[]> {
  const bySplit = await Promise.all(
    BACKGROUND_WAIT_SPLITS.map(async (split) => {
      const raw = JSON.parse(await readFile(join(FIXTURES, `cases-${split}.json`), 'utf8'))
      return z
        .array(caseSchema)
        .parse(raw)
        .map((found) => ({ ...found, split }))
    })
  )
  return bySplit.flat()
}

const TURN_ENDED_AT = Date.UTC(2026, 10, 16, 12)

export function backgroundWaitCaseNow(found: BackgroundWaitCase): number {
  return TURN_ENDED_AT + found.endedAgoSeconds * 1000
}

/** What discovery would attach to the session; null where nothing runs and code settles it alone. */
export function backgroundWaitCaseEvidence(
  found: BackgroundWaitCase
): BackgroundWaitEvidence | null {
  if (!found.commands.some((command) => command.state === 'running')) {
    return null
  }
  return {
    reply: found.reply,
    endedAt: TURN_ENDED_AT,
    registry: found.registry,
    commands: found.commands.map(({ startedBeforeEndSeconds, ...command }) => ({
      ...command,
      startedAt:
        startedBeforeEndSeconds === null ? null : TURN_ENDED_AT - startedBeforeEndSeconds * 1000
    }))
  }
}

/** The session as discovery publishes it, on the status the last-turn rule gives it. */
export function backgroundWaitCaseSession(found: BackgroundWaitCase): LiveSession {
  const evidence = backgroundWaitCaseEvidence(found)
  return {
    id: `local:claude:${found.id}`,
    provider: 'claude',
    providerSessionId: found.id,
    machine: { hostId: 'local', label: 'mac', kind: 'local' },
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: '/repo',
    project: 'repo',
    title: found.id,
    status: evidence && waitsOnFinalTurnCommand(evidence) ? 'waiting-task' : 'your-turn',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: TURN_ENDED_AT,
    startedAt: TURN_ENDED_AT - 6 * 60 * 60_000,
    alive: true,
    pid: 42,
    transcriptPath: '/t.jsonl',
    inputRoutes: [],
    permission: null,
    ...(evidence ? { backgroundWait: evidence } : {})
  }
}
