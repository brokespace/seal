import { rm } from 'node:fs/promises'
import { isProvisionalLiveSessionId } from '../../../shared/live-sessions/live-session-provisional-id'
import { liveSessionTranscriptFiles } from '../../../shared/live-sessions/live-session-transcript-files'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { resolveSessionFilePath } from '../../native-chat/session-file-resolver'

/** A chat's record names no transcript: its provider wrote one under the session id it minted. */
export async function deleteChatTranscripts(
  session: Pick<LiveSession, 'provider' | 'providerSessionId' | 'transcriptPath' | 'cwd'>
): Promise<void> {
  if (isProvisionalLiveSessionId(session.providerSessionId)) {
    return
  }
  const transcriptPath = await resolveSessionFilePath(session.provider, session.providerSessionId, {
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.transcriptPath ? { transcriptPath: session.transcriptPath } : {})
  })
  if (!transcriptPath) {
    return
  }
  await Promise.all(
    liveSessionTranscriptFiles({ provider: session.provider, transcriptPath }).map((file) =>
      rm(file, { recursive: true, force: true })
    )
  )
}
