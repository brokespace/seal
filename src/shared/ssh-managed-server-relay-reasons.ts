/** Why an SSH host is not served by a managed Seal server; kept as the shipped `kind: relay` wire values. */
export const SSH_MANAGED_SERVER_RELAY_REASONS = [
  'orcad_unavailable',
  'relay_terminals_live',
  'relay_terminals_unverifiable',
  'source_changed',
  'deferred',
  'refused',
  'failed'
] as const

export type SshManagedServerRelayReason = (typeof SSH_MANAGED_SERVER_RELAY_REASONS)[number]
