import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'

export const SAMPLE_NOW = 1_800_000_000_000

/** A quiet local Claude session for tests and fixtures; `patch` makes it the case at hand. */
export function sampleLiveSession(id: string, patch: Partial<LiveSession> = {}): LiveSession {
  return {
    id,
    provider: 'claude',
    providerSessionId: id,
    machine: { hostId: 'local', label: 'brian-mbp', kind: 'local' },
    origin: 'external',
    cwd: '/code/seal',
    project: 'seal',
    title: id,
    status: 'idle',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: SAMPLE_NOW - 60_000,
    startedAt: SAMPLE_NOW - 3_600_000,
    alive: true,
    pid: 1,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...patch
  }
}
