import { describe, expect, it } from 'vitest'
import { contextUsageRingReadout, contextUsageState } from './native-chat-context-usage-state'

const NOW = 1_000_000

function usage(usedTokens: number, windowTokens: number, autoCompactAtTokens?: number) {
  return {
    usedTokens,
    windowTokens,
    percentage: windowTokens > 0 ? Math.round((usedTokens / windowTokens) * 100) : 0,
    estimated: false,
    rows: [],
    ...(autoCompactAtTokens === undefined ? {} : { autoCompactAtTokens })
  }
}

describe('contextUsageState', () => {
  it.each([
    // used, window, threshold, state
    [84_000, 200_000, 160_000, 'normal'],
    [127_999, 200_000, 160_000, 'normal'],
    [128_000, 200_000, 160_000, 'near'],
    [151_999, 200_000, 160_000, 'near'],
    [152_000, 200_000, 160_000, 'critical'],
    // The window's own limit still applies when the threshold sits above it.
    [180_000, 200_000, 195_000, 'critical'],
    // Without a threshold the window's share decides, as the percentage the ring shows.
    [158_000, 200_000, undefined, 'normal'],
    [160_000, 200_000, undefined, 'near'],
    [178_000, 200_000, undefined, 'near'],
    [180_000, 200_000, undefined, 'critical'],
    [240_000, 200_000, undefined, 'critical'],
    // Auto-compact off is reported as no threshold.
    [160_000, 200_000, 0, 'near'],
    [0, 0, undefined, 'unknown']
  ] as const)('%i of %i with threshold %s is %s', (used, window, threshold, state) => {
    expect(contextUsageState(usage(used, window, threshold), { now: NOW })).toBe(state)
  })

  it('is unknown without a summary', () => {
    expect(contextUsageState(null, { now: NOW })).toBe('unknown')
  })

  it('says a compaction is running whatever the numbers are', () => {
    expect(contextUsageState(usage(190_000, 200_000), { compacting: true, now: NOW })).toBe(
      'compacting'
    )
    expect(contextUsageState(null, { compacting: true, now: NOW })).toBe('compacting')
  })

  it('reports a compaction for a minute, measured or not', () => {
    const measured = { ...usage(20_000, 200_000), lastCompactedAt: NOW - 59_000 }
    expect(contextUsageState(measured, { now: NOW })).toBe('compacted')
    expect(contextUsageState({ ...measured, lastCompactedAt: NOW - 60_000 }, { now: NOW })).toBe(
      'normal'
    )
    const unmeasured = { ...usage(0, 0), lastCompactedAt: NOW - 1_000 }
    expect(contextUsageState(unmeasured, { now: NOW })).toBe('compacted')
    expect(contextUsageState({ ...unmeasured, lastCompactedAt: NOW - 61_000 }, { now: NOW })).toBe(
      'unknown'
    )
  })

  it('keeps warning when a compaction left the context nearly full', () => {
    const stillFull = { ...usage(185_000, 200_000), lastCompactedAt: NOW - 1_000 }
    expect(contextUsageState(stillFull, { now: NOW })).toBe('critical')
  })
})

describe('contextUsageRingReadout', () => {
  it('states the distance to the auto-compact point when the agent reports one', () => {
    expect(contextUsageRingReadout(usage(84_000, 200_000, 160_000), { now: NOW })).toEqual({
      state: 'normal',
      filled: 42,
      used: '84k',
      window: '200k',
      compactsAt: '160k',
      left: '76k'
    })
  })

  it('leaves the distance out without a threshold and clamps an over-limit arc', () => {
    expect(contextUsageRingReadout(usage(240_000, 200_000), { now: NOW })).toEqual({
      state: 'critical',
      filled: 100,
      used: '240k',
      window: '200k'
    })
  })

  it('draws an empty ring while nothing is measured', () => {
    expect(contextUsageRingReadout(usage(0, 0), { now: NOW })).toEqual({
      state: 'unknown',
      filled: 0,
      used: '',
      window: ''
    })
  })
})
