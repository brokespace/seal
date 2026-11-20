import { deriveRelayHostIdFromPublicKeyB64 } from '../../../src/shared/remote-runtime/relay/relay-host-id'
import type { resolvePairingHostIdentity } from '../host-catalog/host-store'
import { isPinnedMobileRelayCell } from '../transport/relay/mobile-relay-cell-pin'
import type { MobileRelayPairingJournal } from './mobile-relay-pairing-journal'
import type { updateMobileRelayPairingJournal } from './mobile-relay-pairing-journal-store'

// A journal saved before offers tied the relay identity to the host key may point a known host at another relay.
export function journalNamesItsHostsOwnRelay(journal: MobileRelayPairingJournal): boolean {
  const { host, relay } = journal.metadata
  return (
    deriveRelayHostIdFromPublicKeyB64(host.publicKeyB64) === relay.relayHostId &&
    isPinnedMobileRelayCell(relay)
  )
}

/** Call only after a reply the host key sealed: until then the journal must not carry a known host's id. */
export async function adoptKnownHostIdentity(
  journal: MobileRelayPairingJournal,
  dependencies: {
    resolveHostIdentity: typeof resolvePairingHostIdentity
    updateJournal: typeof updateMobileRelayPairingJournal
  }
): Promise<MobileRelayPairingJournal> {
  const host = journal.metadata.host
  const known = await dependencies.resolveHostIdentity(host.publicKeyB64, host.id)
  if (known.id === host.id) {
    return journal
  }
  const next: MobileRelayPairingJournal = {
    ...journal,
    metadata: { ...journal.metadata, host: { ...host, id: known.id, name: known.name } }
  }
  await dependencies.updateJournal(journal.metadata.journalId, () => next.metadata)
  return next
}

// Only secrets minted for this journal's own relay are sent: a stored host credential is never replayed here.
export function recoveryCredentials(
  journal: MobileRelayPairingJournal,
  now: number
): { kind: 'resume' | 'invite'; token: string }[] {
  const credentials: { kind: 'resume' | 'invite'; token: string }[] = [
    { kind: 'resume', token: journal.secrets.pendingResumeToken }
  ]
  if (journal.metadata.relay.inviteExpiresAt > now) {
    credentials.push({ kind: 'invite', token: journal.secrets.inviteToken })
  }
  return credentials
}
