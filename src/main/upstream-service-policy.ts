// Seal is a fork of Orca: these services belong to stablyai, so Seal must never reach them.

/** The inherited updater only knows stablyai/orca release feeds; Seal publishes none yet. */
export function isUpstreamUpdateFeedEnabled(): boolean {
  return false
}

/** Feedback and crash reports would land in stablyai's inbox, not this fork's. */
export function isUpstreamFeedbackEnabled(): boolean {
  return false
}

export const SEAL_ISSUES_URL = 'https://github.com/brokespace/seal/issues'
