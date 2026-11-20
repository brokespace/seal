import { describe, expect, it } from 'vitest'
import { sealAccountName } from './seal-account-candidate-builder'

describe('sealAccountName', () => {
  it('puts the email after a name, once', () => {
    expect(sealAccountName('AR', 'user@answerrocket.com')).toBe('AR (user@answerrocket.com)')
    expect(sealAccountName(' Personal ', 'me@example.com')).toBe('Personal (me@example.com)')
    expect(sealAccountName('AR (user@answerrocket.com)', 'user@answerrocket.com')).toBe(
      'AR (user@answerrocket.com)'
    )
  })

  it('falls back to the bare email, or the name when there is no email', () => {
    expect(sealAccountName(undefined, 'user@answerrocket.com')).toBe('user@answerrocket.com')
    expect(sealAccountName('Work key', null)).toBe('Work key')
    expect(sealAccountName('', null)).toBeNull()
  })
})
