import type { LiveSession } from './live-session-types'

const CLAUDE_SESSION_FILE =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

/** What "Also delete transcript files" removes: the transcript, and Claude's per-session folder beside it. */
export function liveSessionTranscriptFiles(
  session: Pick<LiveSession, 'provider' | 'transcriptPath'>
): string[] {
  const path = session.transcriptPath
  if (!path?.endsWith('.jsonl')) {
    return []
  }
  return session.provider === 'claude' && CLAUDE_SESSION_FILE.test(path)
    ? [path, `${path.slice(0, -'.jsonl'.length)}/`]
    : [path]
}
