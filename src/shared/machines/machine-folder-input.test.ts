import { describe, expect, it } from 'vitest'
import { expandMachineFolderInput, splitMachineFolderInput } from './machine-folder-input'

const context = { homeDir: '/home/bskesse', currentDir: '/srv/app' }

describe('what is typed into Go to folder', () => {
  it.each([
    ['~', '/home/bskesse'],
    ['~/', '/home/bskesse/'],
    ['~/projects/se', '/home/bskesse/projects/se'],
    ['/home/bskesse/projects/', '/home/bskesse/projects/'],
    ['/var//log/./nginx/../', '/var/log/'],
    ['/', '/'],
    ['src/main', '/srv/app/src/main'],
    ['../', '/srv/'],
    ['~other/x', '/srv/app/~other/x'],
    ['C:\\Users\\brian\\', 'C:\\Users\\brian\\']
  ])('expands %j', (typed, expanded) => {
    expect(expandMachineFolderInput(typed, context)).toBe(expanded)
  })

  it('has no path without the folder it would start from', () => {
    expect(expandMachineFolderInput('~/x', { homeDir: null, currentDir: '/srv' })).toBeNull()
    expect(expandMachineFolderInput('x', { homeDir: '/home/b', currentDir: null })).toBeNull()
    expect(expandMachineFolderInput('   ', context)).toBeNull()
  })

  it.each([
    ['/home/bskesse/projects/', { parent: '/home/bskesse/projects', prefix: '' }],
    ['/home/bskesse/pro', { parent: '/home/bskesse', prefix: 'pro' }],
    ['/ho', { parent: '/', prefix: 'ho' }],
    ['/', { parent: '/', prefix: '' }],
    ['C:\\Us', { parent: 'C:\\', prefix: 'Us' }],
    ['C:\\Users\\br', { parent: 'C:\\Users', prefix: 'br' }]
  ])('splits %j into the folder to list and the name being typed', (expanded, split) => {
    expect(splitMachineFolderInput(expanded)).toEqual(split)
  })
})
