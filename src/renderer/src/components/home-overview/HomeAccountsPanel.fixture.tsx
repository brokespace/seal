import { defineFixture } from '../../component-fixtures/component-fixture'
import { BUSY_HOME_ACCOUNTS } from './home-overview.test-fixture'
import { HomeAccountsPanel } from './HomeAccountsPanel'

/** Usage rows, with one account whose session expired and a one-click Sign in. */
export const expiredSession = defineFixture({
  width: 420,
  render: () => <HomeAccountsPanel accounts={BUSY_HOME_ACCOUNTS} onManage={() => {}} />
})
