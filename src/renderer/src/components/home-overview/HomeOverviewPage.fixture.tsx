import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  BUSY_HOME_PROVIDERS,
  EMPTY_HOME_PROVIDERS,
  HOME_FIXTURE_STORE
} from './home-overview.test-fixture'
import { HomeOverview } from './HomeOverviewPage'

export const busy = defineFixture({
  width: 1200,
  store: HOME_FIXTURE_STORE,
  render: () => <HomeOverview providers={BUSY_HOME_PROVIDERS} />
})

export const empty = defineFixture({
  width: 1200,
  render: () => <HomeOverview providers={EMPTY_HOME_PROVIDERS} />
})
