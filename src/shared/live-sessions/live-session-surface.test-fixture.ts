import type { LiveSession } from './live-session-types'

/** The surface and capabilities of a sample session, for tests that are about something else. */
export function sampleSessionSurface(
  origin: LiveSession['origin'] = 'external'
): Pick<LiveSession, 'surface' | 'capabilities'> {
  return {
    surface: origin === 'seal' ? { kind: 'cli', paneKey: 'tab-1:pane-1' } : { kind: 'external' },
    capabilities: {
      send: true,
      answer: 'options',
      transcript: true,
      recap: true,
      context: 'estimated',
      switchSurface: { toChat: true, toCli: false },
      takeOver: origin === 'external'
    }
  }
}
