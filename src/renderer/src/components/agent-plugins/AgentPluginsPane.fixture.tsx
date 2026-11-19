import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  fixtureConnectors,
  FIXTURE_NOW
} from '../settings/seal-connectors/seal-connectors.test-fixture'
import { AgentPluginsInstalled } from './AgentPluginsInstalled'
import { AgentPluginsPaneView } from './AgentPluginsPane'

export const installed = defineFixture({
  width: 760,
  render: () => <AgentPluginsInstalled connectors={fixtureConnectors()} now={FIXTURE_NOW} />
})

export const withTabs = defineFixture({
  width: 760,
  render: () => <AgentPluginsPaneView connectors={fixtureConnectors()} />
})
