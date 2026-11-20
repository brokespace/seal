// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { useSealReloginRequest } from '../settings/seal-accounts/seal-accounts-navigation'
import { HomeAccountsPanel } from './HomeAccountsPanel'

const initialState = useAppStore.getState()

afterEach(() => {
  cleanup()
  useSealReloginRequest.setState({ accountKey: null })
  useAppStore.setState(initialState, true)
})

it('an expired account row signs that account in again without opening the row', () => {
  const onManage = vi.fn()
  render(
    <HomeAccountsPanel
      onManage={onManage}
      accounts={[
        {
          id: 'seal:claude:ada@example.com',
          provider: 'claude',
          providerLabel: 'Claude',
          label: 'ada@example.com',
          active: false,
          limits: null,
          fetching: false,
          needsSignIn: true,
          signInReason: 'expired',
          accountKey: 'claude:ada@example.com'
        }
      ]}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(useSealReloginRequest.getState().accountKey).toBe('claude:ada@example.com')
  expect(useAppStore.getState().activeView).toBe('settings')
  expect(useAppStore.getState().settingsNavigationTarget).toMatchObject({ pane: 'accounts' })
  expect(onManage).not.toHaveBeenCalled()
})
