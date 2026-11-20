import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { AppliesToEditor } from './AppliesToEditor'
import type { AppliesToOptions } from './use-applies-to-options'

const options: AppliesToOptions = {
  machines: [
    { id: 'host:desk-1111', label: 'This computer' },
    { id: 'host:kessel-2222', label: 'kessel-ml' }
  ],
  accounts: [
    { id: 'claude:work@acme.dev', label: 'Work' },
    { id: 'codex:me@example.com', label: 'Personal Codex' }
  ],
  harnesses: [
    { id: 'claude', label: 'Claude' },
    { id: 'codex', label: 'Codex' },
    { id: 'gemini', label: 'Gemini' }
  ]
}

export const everywhere = defineFixture({
  width: 520,
  render: () => (
    <AppliesToEditor
      value={{
        appliesTo: { machines: 'all', accounts: 'all', harnesses: 'all' },
        projectOverrides: []
      }}
      options={options}
      onChange={() => {}}
    />
  )
})

export const narrowedWithOverride = defineFixture({
  width: 520,
  render: () => (
    <AppliesToEditor
      value={{
        appliesTo: {
          machines: ['host:kessel-2222'],
          accounts: 'all',
          harnesses: ['claude', 'codex']
        },
        projectOverrides: [
          { match: 'github.com/acme/*', label: 'Acme repos', state: 'off' },
          { match: '/home/me/seal', machine: 'host:desk-1111', state: 'on' }
        ]
      }}
      options={options}
      onChange={() => {}}
    />
  ),
  interact: (frame) => {
    frame.querySelector<HTMLButtonElement>('[data-applies-to-dimension="Machines"] button')?.click()
  }
})
