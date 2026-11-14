import { defineFixture } from '../../component-fixtures/component-fixture'
import { BUSY_HOME_SESSIONS, EVERY_STATUS_HOME_SESSIONS } from './home-overview.test-fixture'
import { HomeSessionsPanel } from './HomeSessionsPanel'

/** Session rows with a host summary: written, still being written, and none. */
export const summaries = defineFixture({
  width: 640,
  render: () => <HomeSessionsPanel sessions={BUSY_HOME_SESSIONS} now={Date.now()} />
})

/** One card per status code: the dot colors and labels of docs/session-status.md. */
export const statuses = defineFixture({
  width: 640,
  render: () => <HomeSessionsPanel sessions={EVERY_STATUS_HOME_SESSIONS} now={Date.now()} />
})
