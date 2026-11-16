/**
 * Ids Seal makes up while an agent has not named its session: `pid-<pid>` for a process with no
 * transcript yet, `pane-<paneKey>` for a CLI whose hooks report no id, `seal-<chatSessionId>` for
 * a chat before its provider mints one. Nothing can be resumed by them.
 */
const PROVISIONAL_ID = /^(pid|pane|seal)-/

export function isProvisionalLiveSessionId(providerSessionId: string): boolean {
  return PROVISIONAL_ID.test(providerSessionId)
}
