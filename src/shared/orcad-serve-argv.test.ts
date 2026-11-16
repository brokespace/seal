import { describe, expect, it } from 'vitest'
import { orcadServeArgs } from './remote-runtime/serve-supervisor/orcad-serve-argv'

describe('orcadServeArgs', () => {
  it('binds loopback unless the operator names an address', () => {
    expect(orcadServeArgs({ mobilePairing: true })).toEqual([
      '--bind',
      '127.0.0.1',
      '--mobile-pairing'
    ])
    expect(orcadServeArgs({ bind: '0.0.0.0', port: '6768' })).toEqual([
      '--bind',
      '0.0.0.0',
      '--port',
      '6768'
    ])
  })
})
