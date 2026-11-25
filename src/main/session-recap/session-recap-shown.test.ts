import { expect, it } from 'vitest'
import { recapHostReason } from './session-recap-shown'

const base = { on: true, configured: true, checked: true, provider: 'openrouter' } as const

it('names the first thing a user would fix', () => {
  expect(recapHostReason({ ...base, on: false, configured: false })).toEqual({
    kind: 'recaps-off'
  })
  expect(recapHostReason({ ...base, configured: false, checked: false })).toEqual({
    kind: 'provider-unchecked'
  })
  expect(recapHostReason({ ...base, configured: false })).toEqual({
    kind: 'provider-not-set-up',
    provider: 'openrouter'
  })
  expect(recapHostReason(base)).toBeNull()
})
