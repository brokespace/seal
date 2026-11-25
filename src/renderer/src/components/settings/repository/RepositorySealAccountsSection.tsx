import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { matchesRepositoryIdentitySearch } from './identity/repository-identity-search'
import { matchesSettingsSearch } from '../search/settings-search'
import { getSealProjectAccountsSearchEntry } from '../seal-accounts/seal-accounts-search'
import type { Repo } from '../../../../../shared/repo-types'
import type { SealProjectIdentity } from '../../../../../shared/seal-accounts/seal-account-policy'
import { SEAL_ACCOUNT_GROUPS } from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { SealAccounts } from '../seal-accounts/SealAccountsPage'
import { SealRulesSection } from '../seal-accounts/SealRulesSection'
import { getRepositoryAccountsSectionId } from './repository-settings-targets'

const LOCAL_TARGET = { kind: 'local' } as const

/** Decides its own visibility so the project pane needs one line to mount it. */
export function RepositorySealAccountsSection({ repo }: { repo: Repo }): React.JSX.Element | null {
  const searchQuery = useAppStore((state) => state.settingsSearchQuery)
  const visible =
    matchesRepositoryIdentitySearch(searchQuery, repo) ||
    matchesSettingsSearch(searchQuery, getSealProjectAccountsSearchEntry())
  return visible ? <ProjectSealAccounts repo={repo} /> : null
}

/** The account rules for this project: on every machine, or on one machine it is checked out on. */
function ProjectSealAccounts({ repo }: { repo: Repo }): React.JSX.Element {
  const t = useTranslate()
  const project: SealProjectIdentity = {
    remoteKey: repo.gitRemoteIdentity?.canonicalKey ?? null,
    path: repo.path,
    displayName: repo.displayName,
    repoId: repo.id
  }
  // A git remote names the project on every machine; a folder only by its path.
  const match = project.remoteKey ?? repo.path
  const id = getRepositoryAccountsSectionId(repo.id)
  return (
    <SealAccounts target={LOCAL_TARGET}>
      {({ fleet, actions }) =>
        fleet.overview && fleet.status ? (
          <SealRulesSection
            id={id}
            title={t('seal.accounts.project.title', 'Accounts')}
            description={t(
              'seal.accounts.project.description',
              'The Claude and Codex accounts this project’s sessions use. Add a rule for one machine when the project should use a different account there.'
            )}
            scope={{ kind: 'project', project, match, label: repo.displayName }}
            status={fleet.status}
            accounts={SEAL_ACCOUNT_GROUPS.flatMap((group) => fleet.overview?.groups[group] ?? [])}
            machines={fleet.overview.machines.filter((machine) => machine.runsSeal)}
            onSave={actions.saveRule}
            onRemove={actions.removeRule}
          />
        ) : (
          <p id={id} className="text-sm text-muted-foreground" role="status">
            {fleet.error ?? t('seal.accounts.loading', 'Loading accounts…')}
          </p>
        )
      }
    </SealAccounts>
  )
}
