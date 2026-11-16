import { describe, expect, it } from 'vitest'
import {
  selectSealServiceCandidates,
  type SealServiceProbe
} from './seal-service-manager-selection'
import type { SealServiceWish } from './seal-service-policy'

function probe(answer: Partial<SealServiceProbe>): SealServiceProbe {
  return {
    platform: 'linux',
    user: 'dev',
    systemdUser: false,
    launchctl: false,
    guiSession: false,
    pm2: false,
    installed: null,
    registered: false,
    ownServe: null,
    linger: null,
    pm2StartsAtBoot: null,
    ...answer
  }
}

const wished: SealServiceWish = {}
const pm2First: SealServiceWish = { prefer: 'pm2' }
const systemdFirst: SealServiceWish = { prefer: 'systemd-user' }
const launchdFirst: SealServiceWish = { prefer: 'launchd' }
const mac: Partial<SealServiceProbe> = { platform: 'darwin', launchctl: true, guiSession: true }
const macNobodyLoggedIn: Partial<SealServiceProbe> = { ...mac, guiSession: false }

describe('selectSealServiceCandidates', () => {
  it.each<[string, Partial<SealServiceProbe>, SealServiceWish | null, string[]]>([
    ['linux, user systemd', { systemdUser: true }, wished, ['systemd-user', 'detached']],
    [
      'linux, user systemd and pm2: pm2 first',
      { systemdUser: true, pm2: true },
      wished,
      ['pm2', 'systemd-user', 'detached']
    ],
    ['linux, pm2 only (container)', { pm2: true }, wished, ['pm2', 'detached']],
    ['linux, neither', {}, wished, ['detached']],
    ['macOS: launchd is not automatic', mac, wished, ['detached']],
    ['macOS with pm2', { ...mac, pm2: true }, wished, ['pm2', 'detached']],
    ['a systemctl on macOS is not a manager', { ...mac, systemdUser: true }, wished, ['detached']],
    ['another unix with pm2', { platform: 'other', pm2: true }, wished, ['pm2', 'detached']],
    [
      'systemd preferred over pm2',
      { systemdUser: true, pm2: true },
      systemdFirst,
      ['systemd-user', 'pm2', 'detached']
    ],
    ['pm2 preferred but absent', { systemdUser: true }, pm2First, ['systemd-user', 'detached']],
    ['launchd preferred', { ...mac, pm2: true }, launchdFirst, ['launchd', 'pm2', 'detached']],
    [
      'launchd preferred on linux, where a launchctl is not a manager',
      { launchctl: true, guiSession: true, pm2: true },
      launchdFirst,
      ['pm2', 'detached']
    ],
    [
      'launchd preferred, nobody logged in at the screen: pm2 does not stand in',
      { ...macNobodyLoggedIn, pm2: true },
      launchdFirst,
      ['detached']
    ],
    [
      'launchd installed, nobody logged in at the screen: pm2 does not replace it',
      { ...macNobodyLoggedIn, pm2: true, installed: 'launchd' },
      wished,
      ['detached']
    ],
    [
      'the installed manager wins over the automatic order',
      { systemdUser: true, pm2: true, installed: 'systemd-user', registered: true },
      wished,
      ['systemd-user', 'pm2', 'detached']
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
    ],
    [
      'the user’s own seal serve service: no second server',
      {
        systemdUser: true,
        pm2: true,
        ownServe: { manager: 'systemd-user', name: 'seal-serve.service' }
      },
      pm2First,
      ['detached']
    ],
    [
      'the user’s own seal serve service beside an installed one: the marker stays the truth',
      {
        systemdUser: true,
        installed: 'systemd-user',
        registered: true,
        ownServe: { manager: 'systemd-user', name: 'seal-serve.service' }
      },
      null,
      ['systemd-user', 'detached']
    ]
  ])('%s', (_name, answer, wish, expected) => {
    expect(selectSealServiceCandidates(probe(answer), wish)).toEqual(expected)
  })
})
