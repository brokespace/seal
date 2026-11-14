import { ArrowRight } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type {
  SealAccountsStatus,
  SealSessionLiveSwapMode,
  SealSwapEvent
} from '../../../../../shared/seal-accounts/seal-accounts-status'
import type { SealFleetOverview } from '../../../../../shared/seal-accounts/seal-fleet-overview'
import {
  buildSealSwapHistory,
  type SealSwapHistoryRow
} from '../../../../../shared/seal-accounts/seal-swap-history'
import { SealSessionAccountMenu } from '../../seal-session/SealSessionAccountMenu'
import { Badge } from '../../ui/badge'
import { SettingsGroup } from '../section-layout/SettingsGroup'

const MAX_SESSIONS = 12

function formatTime(at: number): string {
  return new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function providerName(provider: string, t: Translate): string {
  return provider === 'claude'
    ? t('seal.accounts.group.claude', 'Claude')
    : t('seal.accounts.group.codex', 'Codex')
}

function reasonLabel(reason: SealSwapEvent['reason'], t: Translate): string {
  switch (reason) {
    case 'manual':
      return t('seal.accounts.history.manual', 'You switched')
    case 'auth-failure':
      return t('seal.accounts.history.authFailure', 'Login stopped working')
    case 'threshold':
      return t('seal.accounts.history.threshold', 'Near its limit')
    case 'rate-limit':
      return t('seal.accounts.history.rateLimit', 'Hit a rate limit')
    case 'not-allowed':
      return t('seal.accounts.history.notAllowed', 'A rule changed')
  }
}

function deliveryLabel(row: SealSwapHistoryRow, t: Translate): string | null {
  switch (row.delivery) {
    case 'live':
      return t('seal.accounts.history.live', 'switched live')
    case 'resume':
      return t('seal.accounts.history.resume', 'resumed on the new account')
    case 'failed':
      return t('seal.accounts.history.failed', 'could not be moved')
    case null:
      return null
  }
}

type SealSessionsSectionProps = {
  overview: SealFleetOverview
  status: SealAccountsStatus
  now: number
  onSwap: (sessionId: string, account: string) => void
  onSetLiveSwap: (sessionId: string, mode: SealSessionLiveSwapMode) => void
}

/** Agent sessions that are open now and the account each runs on. */
export function SealSessionsSection({
  overview,
  status,
  now,
  onSwap,
  onSetLiveSwap
}: SealSessionsSectionProps): React.JSX.Element {
  const t = useTranslate()
  const open = overview.sessions.filter((session) => !session.endedAt).slice(0, MAX_SESSIONS)
  const showMachine = overview.machines.filter((machine) => machine.runsSeal).length > 1
  return (
    <SettingsGroup
      id="seal-accounts-sessions"
      title={t('seal.accounts.sessions.title', 'Running sessions')}
      description={t(
        'seal.accounts.sessions.description',
        'Each open agent session and the account it runs on. Pick another account to move a session.'
      )}
    >
      {open.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
          {t('seal.accounts.sessions.empty', 'No agent sessions are running.')}
        </p>
      ) : (
        open.map((session) => {
          const home = session.machineId === 'local'
          return (
            <div
              key={`${session.machineId}:${session.id}`}
              className="flex items-center gap-2 py-2 text-xs"
              data-settings-row=""
              data-slot="seal-session-row"
            >
              <Badge variant="secondary">{providerName(session.provider, t)}</Badge>
              {home && session.accountKey ? (
                <SealSessionAccountMenu
                  session={session}
                  candidates={status.providers[session.provider].candidates}
                  readAt={now}
                  onSwap={(account) => onSwap(session.id, account)}
                  onSetLiveSwap={(mode) => onSetLiveSwap(session.id, mode)}
                />
              ) : (
                <span className="truncate font-medium">{session.accountLabel}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {[session.projectLabel, showMachine ? session.machineLabel : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {session.warnings.length > 0 ? (
                <Badge variant="outline" title={session.warnings.join('\n')}>
                  {t('seal.accounts.sessions.warning', 'Outside its rule')}
                </Badge>
              ) : null}
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatTime(session.at)}
              </span>
            </div>
          )
        })
      )}
    </SettingsGroup>
  )
}

/** Every account switch, automatic and manual, newest first. */
export function SealSwapHistorySection({
  overview
}: {
  overview: SealFleetOverview
}): React.JSX.Element {
  const t = useTranslate()
  const rows = buildSealSwapHistory(overview)
  const showMachine = overview.machines.filter((machine) => machine.runsSeal).length > 1
  return (
    <SettingsGroup
      id="seal-accounts-history"
      title={t('seal.accounts.history.title', 'Swap history')}
      description={t(
        'seal.accounts.history.description',
        'Every time Seal or you moved new sessions or a running session to another account.'
      )}
    >
      {rows.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
          {t('seal.accounts.history.empty', 'No swaps yet.')}
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-2 py-2 text-xs"
            data-settings-row=""
            data-slot="seal-swap-row"
            title={row.note ?? undefined}
          >
            <Badge variant="secondary">{providerName(row.provider, t)}</Badge>
            <span className="flex min-w-0 items-center gap-1.5">
              {row.fromLabel ? (
                <>
                  <span className="truncate text-muted-foreground">{row.fromLabel}</span>
                  <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                </>
              ) : null}
              <span className="truncate font-medium">{row.toLabel}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {[
                reasonLabel(row.reason, t),
                row.scope === 'launch'
                  ? t('seal.accounts.history.newSessions', 'new sessions')
                  : (row.project ?? t('seal.accounts.history.session', 'running session')),
                deliveryLabel(row, t),
                showMachine ? row.machineLabel : null
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatTime(row.at)}
            </span>
          </div>
        ))
      )}
    </SettingsGroup>
  )
}
