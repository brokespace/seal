import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SettingsSearchEntry } from '../search/settings-search'
import { translateSearchKeyword } from '../search/settings-search-keywords'

export const getSealAccountsSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('seal.accounts.search.accounts.title', 'Claude and Codex accounts'),
    description: translate(
      'seal.accounts.search.accounts.description',
      'Add, sign in again, rename, order, remove and push the accounts Seal runs agents on.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.accounts.search.keyword.claude', 'claude'),
      ...translateSearchKeyword('seal.accounts.search.keyword.codex', 'codex'),
      ...translateSearchKeyword('seal.accounts.search.keyword.account', 'account'),
      ...translateSearchKeyword('seal.accounts.search.keyword.signIn', 'sign in'),
      ...translateSearchKeyword('seal.accounts.search.keyword.login', 'login'),
      ...translateSearchKeyword('seal.accounts.search.keyword.apiKey', 'api key'),
      ...translateSearchKeyword('seal.accounts.search.keyword.setupToken', 'setup token'),
      ...translateSearchKeyword('seal.accounts.search.keyword.usage', 'usage'),
      ...translateSearchKeyword('seal.accounts.search.keyword.machine', 'machine')
    ]
  },
  {
    title: translate('seal.accounts.search.autoSwap.title', 'Auto-swap'),
    description: translate(
      'seal.accounts.search.autoSwap.description',
      'Move to another account when the 5-hour or weekly limit gets close.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.accounts.search.keyword.swap', 'swap'),
      ...translateSearchKeyword('seal.accounts.search.keyword.limit', 'limit'),
      ...translateSearchKeyword('seal.accounts.search.keyword.cooldown', 'cooldown'),
      ...translateSearchKeyword('seal.accounts.search.keyword.quota', 'quota')
    ]
  },
  {
    title: translate('seal.accounts.search.rules.title', 'Account rules'),
    description: translate(
      'seal.accounts.search.rules.description',
      'Choose which accounts a project or a machine may use.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.accounts.search.keyword.rule', 'rule'),
      ...translateSearchKeyword('seal.accounts.search.keyword.project', 'project'),
      ...translateSearchKeyword('seal.accounts.search.keyword.machine', 'machine')
    ]
  },
  {
    title: translate('seal.accounts.search.history.title', 'Swap history'),
    description: translate(
      'seal.accounts.search.history.description',
      'Every account swap Seal made, and why.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.accounts.search.keyword.swap', 'swap'),
      ...translateSearchKeyword('seal.accounts.search.keyword.history', 'history')
    ]
  },
  {
    title: translate('accounts.claude.oauthUsage.title', 'Claude usage polling'),
    description: translate(
      'accounts.claude.oauthUsage.description',
      'Uses your Claude Code sign-in to check usage, credits, and inactive accounts. Turn off to use live terminal readings only.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.accounts.search.keyword.claude', 'claude'),
      ...translateSearchKeyword('seal.accounts.search.keyword.usage', 'usage')
    ]
  },
  {
    title: translate(
      'accounts.claude.switchSessions.settingTitle',
      'When you switch accounts while Claude is running in terminals'
    ),
    description: translate(
      'accounts.claude.switchSessions.settingDescription',
      'Restarting continues each terminal conversation on the new account.'
    ),
    keywords: [
      ...translateSearchKeyword('seal.accounts.search.keyword.claude', 'claude'),
      ...translateSearchKeyword('seal.accounts.search.keyword.swap', 'swap'),
      ...translateSearchKeyword('accounts.claude.switchSessions.keyword.restart', 'restart'),
      ...translateSearchKeyword('accounts.claude.switchSessions.keyword.running', 'running')
    ]
  }
])
