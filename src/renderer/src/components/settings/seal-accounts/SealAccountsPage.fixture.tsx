import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { HostAccountSignInStatus } from '../../../../../shared/host-account-sign-in-types'
import type { SealFleetAccount } from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { SEAL_ACCOUNT_GROUPS } from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { SealAccountsPageView, type SealAccountsPageActions } from './SealAccountsPageView'
import { SealSessionsSection, SealSwapHistorySection } from './SealActivitySections'
import { SealAutoSwapSection } from './SealAutoSwapSection'
import { SealRulesSection } from './SealRulesSection'
import {
  deadLoginScenario,
  emptyScenario,
  FIXTURE_NOW,
  populatedScenario,
  type SealAccountsPageScenario
} from './seal-accounts-page.test-fixture'
import type { SealSignInController } from './use-seal-sign-in'

const done = async (): Promise<boolean> => true

const actions: SealAccountsPageActions = {
  refresh: () => {},
  use: () => {},
  reorder: () => {},
  saveProfile: done,
  remove: done,
  push: () => {},
  importSystemLogin: done,
  addSecret: done,
  setAutoSwap: () => {},
  evaluate: () => {},
  saveRule: done,
  removeRule: () => {},
  syncRules: async () => 'Synced',
  swapSession: () => {},
  setSessionLiveSwap: () => {},
  dismissNotice: () => {}
}

function signIn(status: HostAccountSignInStatus | null = null): SealSignInController {
  return {
    status,
    error: null,
    start: () => {},
    submitCode: async () => null,
    cancel: () => {},
    reset: () => {}
  }
}

function page(
  scenario: SealAccountsPageScenario,
  extra: Partial<Parameters<typeof SealAccountsPageView>[0]> = {}
): React.JSX.Element {
  return (
    <SealAccountsPageView
      overview={scenario.overview}
      status={scenario.status}
      error={null}
      refreshing={false}
      now={FIXTURE_NOW}
      signIn={signIn()}
      actions={actions}
      {...extra}
    />
  )
}

function claudeAccount(scenario: SealAccountsPageScenario, index: number): SealFleetAccount {
  return scenario.overview.groups.claude[index]
}

export const noAccounts = defineFixture({
  width: 860,
  render: () => page(emptyScenario(false))
})

export const noAccountsWithRemovedSystemLogin = defineFixture({
  width: 860,
  render: () => page(emptyScenario(true))
})

export const accounts = defineFixture({
  width: 860,
  render: () => page(populatedScenario())
})

export const deadLogin = defineFixture({
  width: 860,
  render: () => page(deadLoginScenario())
})

export const addAccount = defineFixture({
  width: 860,
  render: () => page(populatedScenario(), { initialDialog: { kind: 'add', group: 'claude' } })
})

export const signInPasteCode = defineFixture({
  width: 860,
  render: () =>
    page(populatedScenario(), {
      initialDialog: { kind: 'add', group: 'claude' },
      signIn: signIn({
        flowId: 'f1',
        provider: 'claude',
        revision: 2,
        phase: 'waiting',
        prompt: {
          url: 'https://claude.ai/oauth/authorize?code=true&client_id=seal',
          userCode: null,
          needsCode: true
        }
      })
    })
})

export const signInDeviceCode = defineFixture({
  width: 860,
  render: () =>
    page(populatedScenario(), {
      initialDialog: { kind: 'add', group: 'codex' },
      signIn: signIn({
        flowId: 'f2',
        provider: 'codex',
        revision: 2,
        phase: 'waiting',
        prompt: {
          url: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-1234',
          needsCode: false
        }
      })
    })
})

export const signedIn = defineFixture({
  width: 860,
  render: () =>
    page(populatedScenario(), {
      initialDialog: { kind: 'add', group: 'claude' },
      signIn: signIn({
        flowId: 'f3',
        provider: 'claude',
        revision: 4,
        phase: 'signedIn',
        seal: {
          accountKey: 'claude:new@acme.dev',
          label: 'new@acme.dev',
          email: 'new@acme.dev',
          outcome: 'added'
        }
      })
    })
})

export const signInFailed = defineFixture({
  width: 860,
  render: () =>
    page(populatedScenario(), {
      initialDialog: { kind: 'add', group: 'claude' },
      signIn: signIn({
        flowId: 'f4',
        provider: 'claude',
        revision: 3,
        phase: 'failed',
        error: 'Claude sign-in timed out after 10 minutes.'
      })
    })
})

export const removeSystemLogin = defineFixture({
  width: 860,
  render: () => {
    const scenario = populatedScenario()
    return page(scenario, {
      initialDialog: { kind: 'remove', account: claudeAccount(scenario, 1) }
    })
  }
})

export const removeAccount = defineFixture({
  width: 860,
  render: () => {
    const scenario = populatedScenario()
    return page(scenario, {
      initialDialog: { kind: 'remove', account: claudeAccount(scenario, 0) }
    })
  }
})

export const editAccount = defineFixture({
  width: 860,
  render: () => {
    const scenario = populatedScenario()
    return page(scenario, { initialDialog: { kind: 'edit', account: claudeAccount(scenario, 0) } })
  }
})

export const addRule = defineFixture({
  width: 860,
  render: () => page(populatedScenario()),
  interact: (frame) => {
    frame.querySelector<HTMLButtonElement>('[data-slot="seal-add-rule"]')?.click()
  }
})

export const accountMenu = defineFixture({
  width: 860,
  render: () => page(populatedScenario()),
  interact: (frame) => {
    const trigger = frame.querySelector<HTMLButtonElement>('[data-slot="seal-account-menu"]')
    trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  }
})

// The page is taller than one capture, so its lower sections get fixtures of their own.
export const autoSwap = defineFixture({
  width: 860,
  render: () => (
    <SealAutoSwapSection
      status={populatedScenario().status}
      onChange={actions.setAutoSwap}
      onEvaluateNow={actions.evaluate}
    />
  )
})

export const rulesSessionsAndHistory = defineFixture({
  width: 860,
  render: () => {
    const { overview, status } = populatedScenario()
    return (
      <div className="space-y-8">
        <SealRulesSection
          status={status}
          accounts={SEAL_ACCOUNT_GROUPS.flatMap((group) => overview.groups[group])}
          machines={overview.machines}
          onSave={actions.saveRule}
          onRemove={actions.removeRule}
          onSync={actions.syncRules}
        />
        <SealSessionsSection
          overview={overview}
          status={status}
          now={FIXTURE_NOW}
          onSwap={actions.swapSession}
          onSetLiveSwap={actions.setSessionLiveSwap}
        />
        <SealSwapHistorySection overview={overview} />
      </div>
    )
  }
})
