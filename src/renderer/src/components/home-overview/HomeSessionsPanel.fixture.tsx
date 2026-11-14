import { defineFixture } from '../../component-fixtures/component-fixture'
import { BUSY_HOME_SESSIONS } from './home-overview.test-fixture'
import { HomeSessionsPanel } from './HomeSessionsPanel'

/** Session rows with a host summary: written, still being written, and none. */
export const summaries = defineFixture({
  width: 640,
  render: () => (
    <HomeSessionsPanel sessions={BUSY_HOME_SESSIONS} now={Date.now()} onOpen={() => {}} />
  )
})
