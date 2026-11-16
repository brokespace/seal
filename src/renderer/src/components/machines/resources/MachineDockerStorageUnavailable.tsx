import React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineDockerUnavailable } from '../../../../../shared/machines/machine-docker-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'

/** Sets `backticked` words in the code face. */
function withCode(text: string): React.ReactNode[] {
  return [...text.matchAll(/`([^`]*)`|[^`]+/g)].map((match) =>
    match[1] === undefined ? (
      <span key={match.index}>{match[0]}</span>
    ) : (
      <code key={match.index}>{match[1]}</code>
    )
  )
}

/** The account an SSH machine is reached as; other machines do not say. */
function accountOf(machine: MachineSummary): string | null {
  return /^([^@\s]+)@/.exec(machine.address ?? '')?.[1] ?? null
}

/** Why there is no Docker inventory to manage, and what would change that. */
export function MachineDockerStorageUnavailable({
  machine,
  docker,
  loading,
  onRefresh
}: {
  machine: MachineSummary
  docker: MachineDockerUnavailable
  loading: boolean
  onRefresh: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const names = { machine: machine.label, user: accountOf(machine) ?? '' }
  const reason = docker.state === 'missing' ? 'missing' : docker.reason
  const copy: { title: string; hint: string | null } =
    reason === 'missing'
      ? {
          title: t(
            'auto.components.machines.dockerStorage.missing.title',
            'Docker is not installed on {{machine}}.',
            names
          ),
          hint: t(
            'auto.components.machines.dockerStorage.missing.hint',
            "Seal looks for the `docker` command on the machine's PATH."
          )
        }
      : reason === 'permission'
        ? {
            title: names.user
              ? t(
                  'auto.components.machines.dockerStorage.permission.title',
                  '{{user}} cannot use Docker on {{machine}}.',
                  names
                )
              : t(
                  'auto.components.machines.dockerStorage.permission.titleNoUser',
                  'This account cannot use Docker on {{machine}}.',
                  names
                ),
            hint: t(
              'auto.components.machines.dockerStorage.permission.hint',
              'Add the account to the `docker` group, then sign in again.'
            )
          }
        : reason === 'not-running'
          ? {
              title: t(
                'auto.components.machines.dockerStorage.notRunning.title',
                'Docker is installed, but its daemon is not running.'
              ),
              hint: null
            }
          : {
              title: t(
                'auto.components.machines.dockerStorage.other.title',
                'Docker did not answer.'
              ),
              hint: null
            }
  return (
    <div className="space-y-2 px-3 py-4 text-xs" data-machine-docker-unavailable={reason}>
      <div className="space-y-1">
        <p className="text-sm font-medium">{copy.title}</p>
        {copy.hint ? (
          <p className="text-muted-foreground [&_code]:font-mono [&_code]:text-foreground">
            {withCode(copy.hint)}
          </p>
        ) : null}
      </div>
      {docker.state === 'unreachable' && docker.message ? (
        <pre
          className="rounded-md bg-muted px-2 py-1.5 font-mono text-2xs whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]"
          data-machine-docker-message
        >
          {docker.message}
        </pre>
      ) : null}
      <MachineDockerStorageRefreshButton loading={loading} onRefresh={onRefresh} />
    </div>
  )
}

/** The labelled refresh of a state that has nothing else to act on. */
export function MachineDockerStorageRefreshButton({
  loading,
  onRefresh
}: {
  loading: boolean
  onRefresh: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      aria-busy={loading}
      onClick={onRefresh}
      data-machine-docker-refresh={loading ? 'loading' : 'idle'}
    >
      <RefreshCw className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
      {t('auto.components.machines.dockerStorage.refresh', 'Refresh')}
    </Button>
  )
}
