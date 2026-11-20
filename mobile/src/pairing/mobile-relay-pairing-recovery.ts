import { Platform } from 'react-native'
import type {
  DeviceCredentialInstalled,
  PairingGetEndpointsResult
} from '../../../src/shared/remote-runtime/relay/mobile-relay-credential-contract'
import type { PairingRelay } from '../../../src/shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { loadHosts, resolvePairingHostIdentity, savePairedHost } from '../host-catalog/host-store'
import {
  promotePairingJournalCredential,
  readMobileRelayCredentialBundle,
  writeMobileRelayCredentialBundle
} from '../host-credentials/mobile-relay-credential-bundle'
import { resolvePairingInviteThroughDirector } from './mobile-relay-invite-director'
import type { MobileRelayPairingJournal } from './mobile-relay-pairing-journal'
import {
  claimMobileRelayPairingJournalPublication,
  clearMobileRelayPairingJournal,
  loadMobileRelayPairingJournal,
  updateMobileRelayPairingJournal
} from './mobile-relay-pairing-journal-store'
import {
  connectMobileRelayForPairing,
  type PairingCandidateClient
} from './mobile-relay-physical-client'
import { isExplicitCredentialRejection } from '../transport/relay/relay-credential-eligibility'
import {
  adoptKnownHostIdentity,
  journalNamesItsHostsOwnRelay,
  recoveryCredentials
} from './pairing-journal-recovery-bounds'
import { createRecoveringPairingRelayCandidate } from './pairing-relay-candidate'
import { relayHost } from './pairing-relay-host'
import {
  relayCredentialProvision,
  relayPairingEndpointsRead
} from './mobile-relay-pairing-operations'

export type MobileRelayPairingRecoveryResult = 'none' | 'recovered' | 'deferred' | 'abandoned'

type RecoveryDependencies = {
  loadJournal: typeof loadMobileRelayPairingJournal
  updateJournal: typeof updateMobileRelayPairingJournal
  clearJournal: typeof clearMobileRelayPairingJournal
  claimJournal: typeof claimMobileRelayPairingJournalPublication
  readCredentialBundle: typeof readMobileRelayCredentialBundle
  writeCredentialBundle: typeof writeMobileRelayCredentialBundle
  loadHosts: typeof loadHosts
  resolveHostIdentity: typeof resolvePairingHostIdentity
  savePairedHost: typeof savePairedHost
  connectRelay: typeof connectMobileRelayForPairing
  resolveInviteDirector: typeof resolvePairingInviteThroughDirector
  now: () => number
  platform: string
}

const defaultDependencies: RecoveryDependencies = {
  loadJournal: loadMobileRelayPairingJournal,
  updateJournal: updateMobileRelayPairingJournal,
  clearJournal: clearMobileRelayPairingJournal,
  claimJournal: claimMobileRelayPairingJournalPublication,
  readCredentialBundle: readMobileRelayCredentialBundle,
  writeCredentialBundle: writeMobileRelayCredentialBundle,
  loadHosts,
  resolveHostIdentity: resolvePairingHostIdentity,
  savePairedHost,
  connectRelay: connectMobileRelayForPairing,
  resolveInviteDirector: resolvePairingInviteThroughDirector,
  now: Date.now,
  platform: Platform.OS
}

// Allow another invite lifetime after expiry so brief outages do not discard recoverable journals.
const ABANDON_GRACE_MS = 10 * 60 * 1000

let recoveryPromise: Promise<MobileRelayPairingRecoveryResult> | null = null

export function recoverMobileRelayPairing(
  overrides: Partial<RecoveryDependencies> = {}
): Promise<MobileRelayPairingRecoveryResult> {
  if (recoveryPromise) {
    return recoveryPromise
  }
  const dependencies = { ...defaultDependencies, ...overrides }
  recoveryPromise = runRecovery(dependencies).finally(() => {
    recoveryPromise = null
  })
  return recoveryPromise
}

// Bound the wait without blocking a new scan; stale recovery loses journal ownership when superseded.
export async function settleMobileRelayPairingRecovery(
  timeoutMs: number,
  overrides: Partial<RecoveryDependencies> = {}
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    recoverMobileRelayPairing(overrides).catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
  ])
  clearTimeout(timer)
}

async function runRecovery(
  dependencies: RecoveryDependencies
): Promise<MobileRelayPairingRecoveryResult> {
  if (dependencies.platform === 'web') {
    return 'none'
  }
  let journal: MobileRelayPairingJournal | null
  try {
    journal = await dependencies.loadJournal()
  } catch {
    return 'deferred'
  }
  if (!journal) {
    return 'none'
  }
  if (!journalNamesItsHostsOwnRelay(journal)) {
    await dependencies.clearJournal(journal.metadata.journalId).catch(() => {})
    return 'abandoned'
  }
  const bundle = await dependencies.readCredentialBundle(journal.metadata.host.id).catch(() => null)
  const hosts = await dependencies.loadHosts().catch(() => [])
  const existing = hosts.find(({ id }) => id === journal!.metadata.host.id)
  if (existing?.relay?.relayHostId === journal.metadata.relay.relayHostId && bundle) {
    await dependencies.clearJournal(journal.metadata.journalId)
    return 'recovered'
  }

  const credentials = recoveryCredentials(journal, dependencies.now())
  // Track committed status separately so local publication failure cannot discard the only durable recovery record.
  let observedCommitted = false
  let rejectedCredentials = 0
  for (const credential of credentials) {
    let client: PairingCandidateClient | null = null
    try {
      client =
        credential.kind === 'invite'
          ? createInviteClient(journal, dependencies, (next) => {
              journal = next
            })
          : dependencies.connectRelay({
              relay: pairingRelay(journal),
              deviceToken: journal.secrets.deviceToken,
              desktopPublicKeyB64: journal.metadata.host.publicKeyB64,
              credential: credential.token,
              expectedCredentialKind: 'resume'
            })
      const endpoints = await getRecoveryStatus(client, journal, credential.kind)
      // That reply was sealed by the host key, so only now may the journal take a known host's identity.
      journal = await adoptKnownHostIdentity(journal, dependencies)
      if (endpoints.installStatus?.state === 'committed') {
        observedCommitted = true
        await publishCommitted(journal, endpoints, dependencies)
        return 'recovered'
      }
      if (credential.kind === 'invite' && endpoints.installStatus?.state === 'not-found') {
        journal = await transitionToInviteAuthorization(journal, dependencies)
        const installReply = await relayCredentialProvision.request(client, {
          reqId: journal.metadata.installReqId,
          newResumeTokenHash: journal.metadata.pendingResumeTokenHash
        })
        const installed = relayCredentialProvision.interpret(installReply)
        const reconciled = await getRecoveryStatus(client, journal, 'invite')
        assertCommitted(reconciled, installed)
        observedCommitted = true
        await publishCommitted(journal, reconciled, dependencies)
        return 'recovered'
      }
    } catch (error) {
      // Why: ambiguous pairing state advances only by credential priority and
      // authoritative status; a transport failure never rewrites the journal.
      if (isExplicitCredentialRejection(error)) {
        rejectedCredentials++
      }
    } finally {
      client?.close()
    }
  }
  // Abandon uncommitted journals only after all credentials are rejected or invite expiry plus outage grace.
  // A known committed install must retain its journal for local persistence retry.
  if (
    !observedCommitted &&
    (rejectedCredentials === credentials.length ||
      journal.metadata.relay.inviteExpiresAt + ABANDON_GRACE_MS <= dependencies.now())
  ) {
    await dependencies.clearJournal(journal.metadata.journalId).catch(() => {})
    return 'abandoned'
  }
  return 'deferred'
}

function createInviteClient(
  journal: MobileRelayPairingJournal,
  dependencies: RecoveryDependencies,
  replaceJournal: (journal: MobileRelayPairingJournal) => void
): PairingCandidateClient {
  return createRecoveringPairingRelayCandidate({
    journal,
    connect: (relay) =>
      dependencies.connectRelay({
        relay,
        deviceToken: journal.secrets.deviceToken,
        desktopPublicKeyB64: journal.metadata.host.publicKeyB64
      }),
    resolveDirector: (relay) => dependencies.resolveInviteDirector({ relay }),
    persistMove: async (relay) => {
      const next = {
        ...journal,
        metadata: {
          ...journal.metadata,
          relay: {
            ...journal.metadata.relay,
            cellUrl: relay.cellUrl,
            assignmentEpoch: relay.assignmentEpoch
          }
        }
      }
      await dependencies.updateJournal(journal.metadata.journalId, () => next.metadata)
      replaceJournal(next)
    },
    now: dependencies.now
  })
}

async function getRecoveryStatus(
  client: PairingCandidateClient,
  journal: MobileRelayPairingJournal,
  kind: 'resume' | 'invite'
) {
  const reply = await relayPairingEndpointsRead.request(client, {
    installReqId: journal.metadata.installReqId,
    ...(kind === 'resume' ? { resumeConfirmReqId: journal.metadata.resumeConfirmReqId } : {})
  })
  return relayPairingEndpointsRead.interpret(reply)
}

async function transitionToInviteAuthorization(
  journal: MobileRelayPairingJournal,
  dependencies: RecoveryDependencies
): Promise<MobileRelayPairingJournal> {
  const next: MobileRelayPairingJournal = {
    ...journal,
    metadata: {
      ...journal.metadata,
      winner: 'relay',
      authorizationMode: 'relay-basis'
    }
  }
  // Why: the branch change becomes durable only after authoritative not-found.
  await dependencies.updateJournal(journal.metadata.journalId, () => next.metadata)
  return next
}

async function publishCommitted(
  journal: MobileRelayPairingJournal,
  endpoints: PairingGetEndpointsResult,
  dependencies: RecoveryDependencies
): Promise<void> {
  if (endpoints.installStatus?.state !== 'committed' || !endpoints.relay) {
    throw new Error('relay pairing recovery was not committed')
  }
  const installed = endpoints.installStatus.result
  const release = await dependencies.claimJournal(journal.metadata.journalId)
  try {
    await writeCommitted(journal, endpoints.relay, installed, dependencies)
  } finally {
    release()
  }
}

async function writeCommitted(
  journal: MobileRelayPairingJournal,
  relay: NonNullable<PairingGetEndpointsResult['relay']>,
  installed: DeviceCredentialInstalled,
  dependencies: RecoveryDependencies
): Promise<void> {
  const reconciledJournal: MobileRelayPairingJournal = {
    ...journal,
    metadata: {
      ...journal.metadata,
      winner: installed.authorizationMode === 'authenticated-direct' ? 'direct' : 'relay',
      authorizationMode: installed.authorizationMode
    }
  }
  if (journal.metadata.authorizationMode !== installed.authorizationMode) {
    await dependencies.updateJournal(journal.metadata.journalId, () => reconciledJournal.metadata)
  }
  await dependencies.writeCredentialBundle(
    promotePairingJournalCredential({ journal: reconciledJournal, installed })
  )
  await dependencies.savePairedHost(relayHost(reconciledJournal, relay))
  await dependencies.clearJournal(journal.metadata.journalId)
}

function pairingRelay(journal: MobileRelayPairingJournal): PairingRelay {
  return { ...journal.metadata.relay, inviteToken: journal.secrets.inviteToken }
}

function assertCommitted(
  endpoints: PairingGetEndpointsResult,
  installed: DeviceCredentialInstalled
): void {
  if (
    endpoints.installStatus?.state !== 'committed' ||
    JSON.stringify(endpoints.installStatus.result) !== JSON.stringify(installed)
  ) {
    throw new Error('relay pairing recovery install was not authoritatively committed')
  }
}

export function resetMobileRelayPairingRecoveryForTests(): void {
  recoveryPromise = null
}
