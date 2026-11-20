import { describe, expect, it } from 'vitest'
import {
  mergeSealConnectorsConfigs,
  sealConnectorsConfigKey,
  stampSealConnectorsEdit
} from './seal-connectors-config-merge'
import {
  APPLIES_TO_ALL,
  emptySealConnectorsConfig,
  type Connector,
  type SealConnectorsConfig,
  type SignInRef
} from './seal-connectors-types'

function signIn(id: string): SignInRef {
  return {
    id,
    label: id,
    kind: 'oauth',
    createdAt: 1,
    enabled: true,
    appliesTo: APPLIES_TO_ALL,
    projectOverrides: []
  }
}

function connector(id: string, signIns: SignInRef[] = []): Connector {
  return {
    id,
    name: id,
    title: id,
    transport: { type: 'http', url: `https://${id}.example/mcp` },
    source: { kind: 'custom' },
    auth: 'oauth',
    signIns,
    disabledTools: [],
    enabled: true,
    appliesTo: APPLIES_TO_ALL,
    projectOverrides: []
  }
}

function edited(
  before: SealConnectorsConfig,
  now: number,
  edit: (config: SealConnectorsConfig) => SealConnectorsConfig
): SealConnectorsConfig {
  return { ...stampSealConnectorsEdit(before, edit(before), now), updatedAt: now }
}

const ids = (config: SealConnectorsConfig) =>
  config.connectors.map((entry) => [entry.id, entry.signIns.map((ref) => ref.id)])

describe('mergeSealConnectorsConfigs', () => {
  it('keeps what two machines added on their own', () => {
    const base = emptySealConnectorsConfig()
    const devHost = edited(base, 100, (c) => ({
      ...c,
      connectors: [connector('slack', [signIn('dev-slack')])]
    }))
    const mlHost = edited(base, 200, (c) => ({
      ...c,
      connectors: [connector('codegraph'), connector('slack', [signIn('ml-slack')])]
    }))
    const merged = mergeSealConnectorsConfigs(devHost, mlHost)
    expect(ids(merged)).toEqual([
      ['slack', ['dev-slack', 'ml-slack']],
      ['codegraph', []]
    ])
    expect(sealConnectorsConfigKey(mergeSealConnectorsConfigs(mlHost, devHost))).toBe(
      sealConnectorsConfigKey(merged)
    )
  })

  it('does not let an older copy bring back a removed sign-in or connector', () => {
    const start = edited(emptySealConnectorsConfig(), 100, (c) => ({
      ...c,
      connectors: [connector('slack', [signIn('a'), signIn('b')]), connector('jira')]
    }))
    const later = edited(start, 300, (c) => ({
      ...c,
      connectors: [connector('slack', [signIn('a')])]
    }))
    const merged = mergeSealConnectorsConfigs(start, later)
    expect(ids(merged)).toEqual([['slack', ['a']]])
    expect(merged.removed).toEqual({ 'signin:b': 300, 'connector:jira': 300 })
  })

  it('takes the later edit of the same item', () => {
    const start = edited(emptySealConnectorsConfig(), 100, (c) => ({
      ...c,
      connectors: [connector('slack')]
    }))
    const offOnOne = edited(start, 200, (c) => ({
      ...c,
      connectors: c.connectors.map((entry) => ({ ...entry, enabled: false }))
    }))
    const renamedOnOther = edited(start, 150, (c) => ({
      ...c,
      connectors: c.connectors.map((entry) => ({ ...entry, title: 'Slack (work)' }))
    }))
    const merged = mergeSealConnectorsConfigs(renamedOnOther, offOnOne)
    expect(merged.connectors.map((entry) => [entry.title, entry.enabled])).toEqual([
      ['slack', false]
    ])
  })
})
