import { describe, expect, it } from 'vitest'
import { parseSealServiceProbe, sealServiceOutcome } from './seal-service-probe'

describe('linger in the service probe', () => {
  it.each<[string, string, boolean | null]>([
    ['logind says lingering is on', 'linger=Linger=yes', true],
    ['logind says lingering is off', 'linger=Linger=no', false],
    ['logind does not answer', 'linger=', null],
    ['the answer has no linger line', '', null]
  ])('%s', (_name, line, expected) => {
    expect(parseSealServiceProbe(`platform=Linux\nuser=dev\n${line}\n`)?.linger).toBe(expected)
  })

  it('records nothing about linger when it is unknown', () => {
    expect(
      sealServiceOutcome('systemd-user', { user: 'dev', linger: null, pm2StartsAtBoot: null })
    ).toEqual({ manager: 'systemd-user', hostUser: 'dev' })
  })
})
