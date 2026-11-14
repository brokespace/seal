import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { LOCAL_USAGE_CREDENTIAL_HOST } from '../usage/usage-credential-host'
import {
  fixtureProviderStatuses,
  stubUtilityModelFixtureHost
} from '../utility-model/utility-model-fixture-host'
import { OpenRouterAccountsSection } from './OpenRouterAccountsSection'

const render = () => (
  <div className="p-4">
    <OpenRouterAccountsSection host={LOCAL_USAGE_CREDENTIAL_HOST} />
  </div>
)

export const saved = defineFixture({
  width: 760,
  setup: stubUtilityModelFixtureHost({
    providers: fixtureProviderStatuses({
      openrouter: {
        configured: true,
        source: 'settings',
        accountHint: 'a41c',
        tokenProtection: 'sealed'
      }
    })
  }),
  render
})

export const notSaved = defineFixture({
  width: 760,
  setup: stubUtilityModelFixtureHost({ providers: fixtureProviderStatuses({}) }),
  render
})

export const fromEnvironment = defineFixture({
  width: 760,
  setup: stubUtilityModelFixtureHost({
    providers: fixtureProviderStatuses({
      openrouter: { configured: true, source: 'environment', accountHint: 'a41c' }
    })
  }),
  render
})
