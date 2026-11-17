import { describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getDefaultSettings } from '../../../../../../shared/constants'
import {
  agentSessionTabFixture,
  repoFixture,
  worktreeFixture
} from '../../surfaces/integration/native-chat-workspace-test-fixtures'
import type { NativeChatComposerSessionPlace } from '../submit/native-chat-structured-composer-transport'
import { createNativeChatComposerWorkspaceSelector } from './native-chat-composer-workspace'

const TAB = 'session-tab'
const THIS_COMPUTER_CHECKOUT = 'shop::/Users/brian/shop'
const REMOTE_CHECKOUT = 'shop-2299::/home/brian/shop'

/** A window on kessel-dev whose active workspace, on this computer, holds the tab of a session running on 2299. */
function windowState(): AppState {
  return {
    ...useAppStore.getInitialState(),
    settings: { ...getDefaultSettings('/Users/brian'), machineName: 'kessel-dev' },
    repos: [
      repoFixture({ id: 'shop', path: '/Users/brian/shop', displayName: 'shop' }),
      repoFixture({
        id: 'shop-2299',
        path: '/home/brian/shop',
        displayName: 'shop',
        executionHostId: 'ssh:2299'
      })
    ],
    worktreesByRepo: {
      shop: [
        worktreeFixture(THIS_COMPUTER_CHECKOUT, '/Users/brian/shop', {
          repoId: 'shop',
          hostId: 'local',
          displayName: 'shop',
          branch: 'refs/heads/main',
          head: '1111111aaaa',
          isMainWorktree: true
        })
      ],
      'shop-2299': [
        worktreeFixture(REMOTE_CHECKOUT, '/home/brian/shop', {
          repoId: 'shop-2299',
          hostId: 'ssh:2299',
          displayName: 'payments',
          branch: 'refs/heads/feature/payments',
          head: '2222222bbbb'
        })
      ]
    },
    activeWorktreeId: THIS_COMPUTER_CHECKOUT,
    unifiedTabsByWorktree: {
      [THIS_COMPUTER_CHECKOUT]: [
        agentSessionTabFixture(TAB, THIS_COMPUTER_CHECKOUT, {
          contentType: 'external-agent-session',
          executionHostId: 'local'
        })
      ]
    }
  }
}

function footerOf(sessionPlace: NativeChatComposerSessionPlace | null) {
  return createNativeChatComposerWorkspaceSelector(TAB, {
    worktreeId: THIS_COMPUTER_CHECKOUT,
    runtimeEnvironmentId: null,
    sessionPlace
  })(windowState())
}

describe('the composer footer of a session Seal does not host', () => {
  it('shows the machine, folder and branch of the session, not of the workspace holding its tab', () => {
    expect(
      footerOf({
        executionHostId: 'ssh:2299',
        machine: '2299',
        cwd: '/home/brian/shop/services/api',
        project: 'api',
        worktreeId: REMOTE_CHECKOUT
      })
    ).toEqual({
      hostId: 'ssh:2299',
      machine: '2299',
      worktreeId: REMOTE_CHECKOUT,
      repoId: 'shop-2299',
      checkout: 'payments',
      kind: 'worktree',
      path: '/home/brian/shop/services/api',
      branch: 'refs/heads/feature/payments',
      head: '2222222bbbb'
    })
  })

  it('shows no branch for a session whose folder no workspace of its machine holds', () => {
    const elsewhere = {
      hostId: 'ssh:2299',
      machine: '2299',
      checkout: 'scratch',
      path: '/home/brian/scratch'
    }
    const place = {
      executionHostId: 'ssh:2299' as const,
      machine: '2299',
      cwd: '/home/brian/scratch',
      project: 'scratch'
    }
    expect(footerOf({ ...place, worktreeId: null })).toEqual(elsewhere)
    expect(footerOf({ ...place, worktreeId: REMOTE_CHECKOUT })).toEqual(elsewhere)
    // The id of a workspace on this computer names nothing on 2299.
    expect(footerOf({ ...place, worktreeId: THIS_COMPUTER_CHECKOUT })).toEqual(elsewhere)
  })

  it('shows nothing while the registry lists no record of the session', () => {
    expect(footerOf(null)).toEqual({})
  })
})
