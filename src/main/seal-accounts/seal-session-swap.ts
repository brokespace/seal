import { join } from 'node:path'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import type { SealSwapReason } from '../../shared/seal-accounts/seal-auto-swap-decision'
import type {
  SealSessionAssignment,
  SealSessionSwapEntry
} from '../../shared/seal-accounts/seal-accounts-status'
import { sessionSwapDelivery } from '../../shared/seal-accounts/seal-session-swap-decision'
import type { SealAccountManager } from './seal-account-manager'
import { sealPinnedPointerPath, pinClaudeLaunchToHome } from './seal-claude-launch-pin'
import { codexLoginJson, copyClaudeLoginInto, sealSessionPointerName } from './seal-session-launch'
import { provisionClaudeSessionHome, provisionCodexSessionHome } from './seal-session-homes'
import { reconcileCodexLogin } from './seal-login-copies'
import { resumeCommandLine, sealSessionTerminal, stopAgentInPane } from './seal-session-terminal'

const MAX_SESSION_HISTORY = 20

export type SealSessionSwapRequest = {
  sessionId: string
  to: SealAccountCandidate
  reason: SealSwapReason | 'manual'
  /** The agent's conversation id, from its status hooks; needed for a resume. */
  providerSessionId: string | null
  /** Re-prompt a session that stopped on its limit once the new login is in. */
  continueAfter?: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function outgoingAccount(manager: SealAccountManager, session: SealSessionAssignment) {
  const key = session.accountKey
  return key
    ? (manager
        .candidates(session.provider)
        .find((entry) => entry.kind === 'oauth' && sealAccountKeysMatch(entry.key, key)) ?? null)
    : null
}

/** A Codex session may have refreshed its copy; its account takes that token before the swap. */
async function backUpOutgoingCodex(
  manager: SealAccountManager,
  session: SealSessionAssignment
): Promise<void> {
  const outgoing = outgoingAccount(manager, session)
  if (outgoing?.localId && session.profileHome) {
    await reconcileCodexLogin(manager, { accountId: outgoing.localId, accountKey: outgoing.key })
  }
}

function requireSession(manager: SealAccountManager, id: string): SealSessionAssignment {
  const session = manager.store.getState().sessions.find((entry) => entry.id === id)
  if (!session) {
    throw new Error('That session is no longer tracked on this machine.')
  }
  return session
}

/** Gives a session that launched on the shared login its own home, holding the new login. */
async function homeForResume(
  manager: SealAccountManager,
  session: SealSessionAssignment,
  to: SealAccountCandidate
): Promise<{ home: string; claudePointer?: string; codexHome?: string }> {
  if (session.provider === 'claude') {
    const home = session.profileHome ?? (await provisionClaudeSessionHome(manager, session.id))
    await copyClaudeLoginInto(manager, to, home, outgoingAccount(manager, session))
    const pointerName = sealSessionPointerName(session.id)
    await pinClaudeLaunchToHome({ dataRoot: manager.dataRoot, pin: pointerName, home, env: {} })
    return session.profileHome
      ? { home }
      : { home, claudePointer: sealPinnedPointerPath(manager.dataRoot, pointerName) }
  }
  await backUpOutgoingCodex(manager, session)
  const { authJson } = await codexLoginJson(manager, to)
  if (session.profileHome) {
    writeSecureFile(join(session.profileHome, 'auth.json'), authJson)
    return { home: session.profileHome }
  }
  // Link the old account's home so the transcript is still there to resume.
  const from = manager.candidates('codex').find((entry) => entry.key === session.accountKey)
  const transcriptHome = from?.localId ? manager.codexHome(from.localId) : null
  if (!transcriptHome) {
    throw new Error('Seal cannot find this Codex session’s history to resume it.')
  }
  const home = await provisionCodexSessionHome(
    manager.dataRoot,
    session.id,
    transcriptHome,
    authJson
  )
  return { home, codexHome: home }
}

async function deliver(
  manager: SealAccountManager,
  session: SealSessionAssignment,
  request: SealSessionSwapRequest
): Promise<{ delivery: SealSessionSwapEntry['delivery']; home: string | null; note?: string }> {
  const pane = sealSessionTerminal()
  const handle = session.paneKey && pane ? pane.handleForPane(session.paneKey) : null
  const delivery = sessionSwapDelivery(
    {
      provider: session.provider,
      isolatedHome: Boolean(session.profileHome),
      resumable: Boolean(handle && request.providerSessionId)
    },
    request.reason
  )
  if (!delivery) {
    throw new Error('This session has no saved conversation id or open pane to resume from.')
  }
  if (delivery === 'live' && session.profileHome) {
    if (session.provider === 'claude') {
      await copyClaudeLoginInto(
        manager,
        request.to,
        session.profileHome,
        outgoingAccount(manager, session)
      )
    } else {
      await backUpOutgoingCodex(manager, session)
      const { authJson } = await codexLoginJson(manager, request.to)
      writeSecureFile(join(session.profileHome, 'auth.json'), authJson)
    }
    if (request.continueAfter && handle && pane) {
      await pane.send(handle, { text: 'continue', enter: true })
    }
    return { delivery, home: session.profileHome }
  }
  if (!pane || !handle || !request.providerSessionId) {
    throw new Error('This session’s pane is closed.')
  }
  const prepared = await homeForResume(manager, session, request.to)
  if (!(await stopAgentInPane(pane, handle))) {
    return { delivery: 'failed', home: prepared.home, note: 'The agent did not exit to resume.' }
  }
  await pane.send(handle, {
    text: resumeCommandLine({
      provider: session.provider,
      providerSessionId: request.providerSessionId,
      platform: process.platform,
      claudePointer: prepared.claudePointer,
      codexHome: prepared.codexHome
    }),
    enter: true
  })
  return {
    delivery: 'resume',
    home: prepared.home,
    note: 'The agent could not take the new login live, so Seal resumed the conversation on it.'
  }
}

/** Moves one running session to another account and logs it in that session's history. */
export async function swapSealSession(
  manager: SealAccountManager,
  request: SealSessionSwapRequest
): Promise<SealSessionSwapEntry> {
  const session = requireSession(manager, request.sessionId)
  if (request.to.provider !== session.provider) {
    throw new Error(
      `A ${session.provider} session can only move to another ${session.provider} account.`
    )
  }
  if (request.to.kind === 'api-key') {
    throw new Error(
      'API keys apply when a session starts; pick a signed-in account to move this one.'
    )
  }
  if (session.accountKey && sealAccountKeysMatch(session.accountKey, request.to.key)) {
    throw new Error(`This session already runs on ${request.to.label}.`)
  }
  let outcome: Awaited<ReturnType<typeof deliver>>
  try {
    outcome = await deliver(manager, session, request)
  } catch (error) {
    outcome = { delivery: 'failed', home: session.profileHome ?? null, note: errorMessage(error) }
  }
  const entry: SealSessionSwapEntry = {
    at: manager.now(),
    from: session.accountKey,
    fromLabel: session.accountLabel,
    to: request.to.key,
    toLabel: request.to.label,
    reason: request.reason,
    delivery: outcome.delivery,
    ...(outcome.note ? { note: outcome.note } : {})
  }
  manager.store.updateState((next) => {
    const target = next.sessions.find((candidate) => candidate.id === session.id)
    if (!target) {
      return
    }
    target.history = [...(target.history ?? []), entry].slice(-MAX_SESSION_HISTORY)
    target.lastSwapAt = entry.at
    target.profileHome = outcome.home
    if (entry.delivery !== 'failed') {
      target.accountKey = request.to.key
      target.accountLabel = request.to.label
    }
  })
  const verb = entry.delivery === 'failed' ? 'could not move' : `moved (${entry.delivery})`
  console.log(
    `[seal-accounts] ${session.provider} session ${verb} to ${request.to.label} (${request.reason})`
  )
  return entry
}

/** A manual move from the CLI or a session badge: by account ref, with the pane's conversation id. */
export function swapSealSessionTo(
  manager: SealAccountManager,
  sessionId: string,
  ref: string
): Promise<SealSessionSwapEntry> {
  const session = requireSession(manager, sessionId)
  const to = manager.requireCandidate(session.provider, ref)
  const row = session.paneKey
    ? sealSessionTerminal()
        ?.statusRows()
        .find((entry) => entry.paneKey === session.paneKey)
    : undefined
  return swapSealSession(manager, {
    sessionId,
    to,
    reason: 'manual',
    providerSessionId: row?.providerSession?.id ?? null
  })
}

export function setSealSessionLiveSwap(
  manager: SealAccountManager,
  sessionId: string,
  mode: NonNullable<SealSessionAssignment['liveSwap']>
): void {
  requireSession(manager, sessionId)
  manager.store.updateState((next) => {
    const target = next.sessions.find((entry) => entry.id === sessionId)
    if (target) {
      target.liveSwap = mode
    }
  })
}
