import { describe, expect, it } from 'vitest'
import { parseOwnSealServe } from './own-seal-serve-probe'

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
