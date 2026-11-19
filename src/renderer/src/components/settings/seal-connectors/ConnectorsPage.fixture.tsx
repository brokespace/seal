import { defineFixture } from '../../../component-fixtures/component-fixture'
import { ConnectorsPageView } from './ConnectorsPage'
import { MachineConnectorsSectionView } from './ConnectorsHere'
import { fixtureConnectors, FIXTURE_NOW } from './seal-connectors.test-fixture'

export const list = defineFixture({
  width: 760,
  render: () => <ConnectorsPageView connectors={fixtureConnectors()} now={FIXTURE_NOW} />
})

export const detailSheet = defineFixture({
  width: 1100,
  render: () => (
    <ConnectorsPageView connectors={fixtureConnectors()} now={FIXTURE_NOW} initialOpenId="slack" />
  )
})

export const addConnector = defineFixture({
  width: 900,
  render: () => (
    <ConnectorsPageView connectors={fixtureConnectors()} now={FIXTURE_NOW} initialAdding />
  ),
  setup: () => {
    window.api.runtime.call = async () => ({
      id: 'fixture',
      ok: true,
      _meta: { runtimeId: 'fixture' },
      result: {
        entries: [
          {
            name: 'slack',
            description: 'Search Slack and post messages.',
            listings: [
              {
                harness: 'claude',
                id: 'slack@claude-plugins-official',
                marketplace: 'claude-plugins-official',
                version: null,
                installed: false,
                enabled: false
              }
            ],
            components: {
              mcpServers: ['slack'],
              skills: ['a', 'b'],
              commands: [],
              agents: [],
              hooks: [],
              lspServers: [],
              apps: []
            }
          }
        ],
        harnesses: [
          { harness: 'claude', available: true },
          { harness: 'codex', available: true }
        ]
      }
    })
  }
})

export const noConnectors = defineFixture({
  width: 760,
  render: () => (
    <ConnectorsPageView
      connectors={fixtureConnectors({}, { ...fixtureConnectors().config!, connectors: [] })}
      now={FIXTURE_NOW}
    />
  )
})

export const connectorsOnMachine = defineFixture({
  width: 760,
  render: () => (
    <MachineConnectorsSectionView
      connectors={fixtureConnectors()}
      machineKeys={['env-kessel']}
      now={FIXTURE_NOW}
    />
  )
})
