import { describe, expect, it } from 'vitest'
import { withoutBearerClientId } from './bearer-client-id'

const BEARER = 'bearer-a-phone-presents'
const DEVICE_ID = 'device-1'

function mapped(request: Record<string, unknown>) {
  return withoutBearerClientId(
    { id: 'r1', authToken: '', method: 'terminal.subscribe', ...request },
    JSON.stringify(request),
    BEARER,
    DEVICE_ID
  )
}

describe('withoutBearerClientId', () => {
  it('names the device wherever a phone used its bearer as an identifier', () => {
    const request = mapped({
      deviceToken: BEARER,
      params: {
        terminal: 'term-1',
        client: { id: BEARER, type: 'mobile' },
        subscriptionId: `term-1:${BEARER}`
      }
    })

    expect(request.params).toEqual({
      terminal: 'term-1',
      client: { id: 'device-1', type: 'mobile' },
      subscriptionId: 'term-1:device-1'
    })
  })

  it('leaves a request that only authenticates with the bearer untouched', () => {
    const params = { terminal: 'term-1', client: { id: 'device-1', type: 'mobile' } }

    expect(mapped({ deviceToken: BEARER, params }).params).toBe(params)
  })
})
