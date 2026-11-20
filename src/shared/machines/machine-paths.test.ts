import { describe, expect, it } from 'vitest'
import {
  isValidMachineFileName,
  joinMachinePath,
  machinePathBasename,
  machinePathCrumbs,
  machinePathDirname
} from './machine-paths'

describe('machine paths', () => {
  it('joins and splits POSIX paths, stopping at the root', () => {
    expect(joinMachinePath('/', 'home')).toBe('/home')
    expect(joinMachinePath('/home/me/', 'a b')).toBe('/home/me/a b')
    expect(machinePathBasename('/home/me/')).toBe('me')
    expect(machinePathDirname('/home/me')).toBe('/home')
    expect(machinePathDirname('/home')).toBe('/')
    expect(machinePathDirname('/')).toBeNull()
  })

  it('keeps Windows drive roots and backslashes intact', () => {
    expect(joinMachinePath('C:\\', 'Users')).toBe('C:\\Users')
    expect(joinMachinePath('C:\\Users', 'me')).toBe('C:\\Users\\me')
    expect(machinePathDirname('C:\\Users')).toBe('C:\\')
    expect(machinePathDirname('C:\\')).toBeNull()
    expect(machinePathBasename('C:\\Users\\me')).toBe('me')
  })

  it('builds breadcrumbs from the root down', () => {
    expect(machinePathCrumbs('/srv/app')).toEqual([
      { label: '/', path: '/' },
      { label: 'srv', path: '/srv' },
      { label: 'app', path: '/srv/app' }
    ])
    expect(machinePathCrumbs('D:\\data').map((c) => c.label)).toEqual(['D:\\', 'data'])
  })

  it('rejects names that would escape their folder', () => {
    expect(isValidMachineFileName('report (1).pdf')).toBe(true)
    for (const bad of ['', '  ', '.', '..', 'a/b', 'a\\b', 'nul\0byte']) {
      expect(isValidMachineFileName(bad)).toBe(false)
    }
  })
})
