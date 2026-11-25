import { describe, expect, it } from 'vitest'
import { estimateSwap } from './seal-swap-estimate'

const NOW = 1_800_000_000_000
const MINUTE = 60_000
const lines = { session: 90, weekly: 90 }

describe('estimateSwap', () => {
  it('projects the recent climb between two readings to the line', () => {
    const previous = {
      at: NOW - 10 * MINUTE,
      readings: [{ label: '5h', pct: 70, resetsAt: NOW + 3 * 60 * MINUTE }]
    }
    const latest = {
      at: NOW,
      readings: [{ label: '5h', pct: 80, resetsAt: NOW + 3 * 60 * MINUTE }]
    }
    // 1 point a minute, 10 points to go.
    expect(estimateSwap(latest, previous, lines, NOW)).toEqual({
      at: NOW + 10 * MINUTE,
      window: '5h',
      line: 90
    })
  })

  it('falls back to the window average, and expects nothing when the reset comes first', () => {
    // 60% used 150 minutes into a 5h window: 0.4 points a minute, the line 75 minutes out.
    const halfway = { at: NOW, readings: [{ label: '5h', pct: 60, resetsAt: NOW + 150 * MINUTE }] }
    expect(estimateSwap(halfway, null, lines, NOW)).toEqual({
      at: NOW + 75 * MINUTE,
      window: '5h',
      line: 90
    })
    const slow = { at: NOW, readings: [{ label: '5h', pct: 20, resetsAt: NOW + 150 * MINUTE }] }
    expect(estimateSwap(slow, null, lines, NOW)).toBeNull()
  })
})
