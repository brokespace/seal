import { describe, expect, it } from 'vitest'
import {
  parseOwnSealServe,
  parseOwnSealServeStartCommand,
  type OwnSealServe
} from './own-seal-serve-probe'

const SYSTEMD_SERVE: OwnSealServe = { manager: 'systemd-user', name: 'seal-serve-0123abcd.service' }
const LAUNCHD_SERVE: OwnSealServe = { manager: 'launchd', name: 'com.brokespace.seal.serve' }

describe('parseOwnSealServeStartCommand', () => {
  it.each<[string, OwnSealServe, string, string | null]>([
    [
      'a stopped systemd unit',
      SYSTEMD_SERVE,
      'own_serve_state=inactive\n',
      'systemctl --user start seal-serve-0123abcd.service'
    ],
    [
      'a failed systemd unit',
      SYSTEMD_SERVE,
      'own_serve_state=failed\n',
      'systemctl --user start seal-serve-0123abcd.service'
    ],
    ['a running systemd unit', SYSTEMD_SERVE, 'own_serve_state=active\n', null],
    ['a systemd that did not answer', SYSTEMD_SERVE, 'own_serve_state=\n', null],
    [
      'a loaded launchd agent that is not running',
      LAUNCHD_SERVE,
      'own_serve_state=not running\n',
      'launchctl kickstart gui/$(id -u)/com.brokespace.seal.serve'
    ],
    [
      'a launchd agent that is not loaded',
      LAUNCHD_SERVE,
      'own_serve_state=not-loaded\n',
      'launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.brokespace.seal.serve.plist'
    ],
    ['a running launchd agent', LAUNCHD_SERVE, 'own_serve_state=running\n', null],
    ['a launchd that did not answer', LAUNCHD_SERVE, 'own_serve_state=\n', null]
  ])('%s', (_name, serve, output, expected) => {
    expect(parseOwnSealServeStartCommand(serve, output)).toBe(expected)
  })
})

describe('parseOwnSealServe', () => {
  it.each([
    [
      '/home/dev/.config/systemd/user/seal-serve.service',
      { manager: 'systemd-user', name: 'seal-serve.service' }
    ],
    [
      '/home/dev/.config/systemd/user/seal-serve-0123abcd.service',
      { manager: 'systemd-user', name: 'seal-serve-0123abcd.service' }
    ],
    [
      '/Users/dev/Library/LaunchAgents/com.brokespace.seal.serve.plist',
      { manager: 'launchd', name: 'com.brokespace.seal.serve' }
    ],
    [
      '/Users/dev/Library/LaunchAgents/com.brokespace.seal.serve.0123abcd.plist',
      { manager: 'launchd', name: 'com.brokespace.seal.serve.0123abcd' }
    ]
  ])('finds %s', (unitFile, expected) => {
    expect(parseOwnSealServe(unitFile)).toEqual(expected)
  })

  it.each([
    // Seal's own managed service, and the browser helper's label, start with the serve names.
    '/home/dev/.config/systemd/user/seal-server.service',
    '/Users/dev/Library/LaunchAgents/com.brokespace.seal.server.plist',
    '/Users/dev/Library/LaunchAgents/com.brokespace.seal.serve.orcad-browser.plist',
    '/home/dev/.config/systemd/user/seal-serve-0123abcd9.service',
    '/home/dev/.config/systemd/user/seal-serve-0123ABCD.service',
    '/Users/dev/Library/LaunchAgents/com.brokespace.seal.serve.0123abc.plist',
    '/Users/dev/Library/LaunchAgents/com.brokespace.seal.serve',
    '',
    undefined
  ])('ignores %s', (unitFile) => {
    expect(parseOwnSealServe(unitFile)).toBeNull()
  })
})
