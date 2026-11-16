import { describe, expect, it } from 'vitest'
import {
  selectSealServiceCandidates,
  type SealServiceProbe
} from './seal-service-manager-selection'
import type { SealServiceWish } from './seal-service-policy'

function probe(answer: Partial<SealServiceProbe>): SealServiceProbe {
  return {
    platform: 'linux',
    systemdUser: false,
    launchctl: false,
    pm2: false,
    installed: null,
    registered: false,
    linger: null,
    pm2StartsAtBoot: null,
    ...answer
  }
}

const wished: SealServiceWish = {}
const pm2First: SealServiceWish = { prefer: 'pm2' }

describe('selectSealServiceCandidates', () => {
  it.each<[string, Partial<SealServiceProbe>, SealServiceWish | null, string[]]>([
    ['linux, user systemd', { systemdUser: true }, wished, ['systemd-user', 'detached']],
    [
      'linux, user systemd and pm2',
      { systemdUser: true, pm2: true },
      wished,
      ['systemd-user', 'pm2', 'detached']
    ],
    ['linux, pm2 only (container)', { pm2: true }, wished, ['pm2', 'detached']],
    ['linux, neither', {}, wished, ['detached']],
    ['macOS', { platform: 'darwin', launchctl: true }, wished, ['launchd', 'detached']],
    [
      'macOS with pm2',
      { platform: 'darwin', launchctl: true, pm2: true },
      wished,
      ['launchd', 'pm2', 'detached']
    ],
    [
      'a systemctl on macOS is not the native manager',
      { platform: 'darwin', systemdUser: true, launchctl: true },
      wished,
      ['launchd', 'detached']
    ],
    [
      'a launchctl on linux is not the native manager',
      { launchctl: true, pm2: true },
      wished,
      ['pm2', 'detached']
    ],
    ['another unix with pm2', { platform: 'other', pm2: true }, wished, ['pm2', 'detached']],
    [
      'pm2 preferred',
      { systemdUser: true, pm2: true },
      pm2First,
      ['pm2', 'systemd-user', 'detached']
    ],
    ['pm2 preferred but absent', { systemdUser: true }, pm2First, ['systemd-user', 'detached']],
    [
      'the installed manager wins over the native one',
      { systemdUser: true, pm2: true, installed: 'pm2', registered: true },
      wished,
      ['pm2', 'systemd-user', 'detached']
    ],
    [
      'the installed manager wins over the preference',
      { systemdUser: true, pm2: true, installed: 'systemd-user', registered: true },
      pm2First,
      ['systemd-user', 'pm2', 'detached']
    ],
    [
      'an installed manager that no longer works is replaced',
      { systemdUser: true, installed: 'pm2' },
      wished,
      ['systemd-user', 'detached']
    ],
    [
      'no wish, nothing installed: nothing new',
      { systemdUser: true, pm2: true },
      null,
      ['detached']
    ],
    [
      'no wish, a second desktop: the installed manager',
      { systemdUser: true, pm2: true, installed: 'pm2', registered: true },
      null,
      ['pm2', 'detached']
    ],
    [
      'no wish, the installed manager stopped working: nothing new',
      { systemdUser: true, installed: 'pm2' },
      null,
      ['detached']
    ]
  ])('%s', (_name, answer, wish, expected) => {
    expect(selectSealServiceCandidates(probe(answer), wish)).toEqual(expected)
  })
})
