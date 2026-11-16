import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  BUSY_HOME_SESSIONS,
  EVERY_STATUS_HOME_SESSIONS,
  HOME_FIXTURE_STORE
} from './home-overview.test-fixture'
import { HomeSessionsPanel } from './HomeSessionsPanel'

/** Needs you, then projects and workspaces on two machines; rows with a summary written, pending, and none. */
export const summaries = defineFixture({
  width: 640,
  store: HOME_FIXTURE_STORE,
  render: () => <HomeSessionsPanel sessions={BUSY_HOME_SESSIONS} now={Date.now()} />
})

/** One card per status code: the dot colors and labels of docs/design/agent-status.md. */
export const statuses = defineFixture({
  width: 640,
  render: () => <HomeSessionsPanel sessions={EVERY_STATUS_HOME_SESSIONS} now={Date.now()} />
})
