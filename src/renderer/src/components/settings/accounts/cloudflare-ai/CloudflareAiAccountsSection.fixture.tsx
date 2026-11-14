import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { LOCAL_USAGE_CREDENTIAL_HOST } from '../usage/usage-credential-host'
import {
  fixtureProviderStatuses,
  stubUtilityModelFixtureHost
} from '../utility-model/utility-model-fixture-host'
import { CloudflareAiAccountsSection } from './CloudflareAiAccountsSection'

const render = () => (
  <div className="p-4">
    <CloudflareAiAccountsSection host={LOCAL_USAGE_CREDENTIAL_HOST} />
  </div>
)

export const linked = defineFixture({
  width: 760,
  setup: stubUtilityModelFixtureHost({
    providers: fixtureProviderStatuses({
      'cloudflare-workers-ai': {
        configured: true,
        source: 'settings',
        accountHint: '9f3c',
        tokenProtection: 'sealed'
      }
    })
  }),
  render
})

export const notLinked = defineFixture({
  width: 760,
  setup: stubUtilityModelFixtureHost({ providers: fixtureProviderStatuses({}) }),
  render
})

/** A spent daily allocation pauses the account until the next UTC day. */
export const freePlanLimits = defineFixture({
  width: 760,
  setup: stubUtilityModelFixtureHost({
    providers: fixtureProviderStatuses({
      'cloudflare-workers-ai': {
        configured: true,
        source: 'config-file',
        accountHint: '9f3c',
        pausedUntil: new Date().setUTCHours(24, 0, 0, 0)
      }
    })
  }),
  render
})
