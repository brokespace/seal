import { describe, expect, it } from 'vitest'
import { completedFolderInput, folderMatchesFor, sharedFolderInput } from './machine-folder-typing'

const home = '/home/bskesse'

describe('Tab in Go to folder', () => {
  it.each([
    ['/home/bskesse/pro', '/home/bskesse/projects', '/home/bskesse/projects/'],
    ['~/pro', '/home/bskesse/projects', '~/projects/'],
    ['~', '/home/bskesse', '~/'],
    ['~/../', '/home/other', '/home/other/'],
    ['src', '/srv/app/src', '/srv/app/src/'],
    ['C:\\Us', 'C:\\Users', 'C:\\Users\\']
  ])('completes %j with the picked folder', (typed, picked, completed) => {
    expect(completedFolderInput(typed, picked, home)).toBe(completed)
  })

  it('extends to what several candidates share, and no further', () => {
    expect(sharedFolderInput('~/p', home, ['projects', 'prototypes'], home)).toBe('~/pro')
    expect(sharedFolderInput('~/pro', home, ['projects', 'prototypes'], home)).toBeNull()
    expect(sharedFolderInput('/srv/se', '/srv', ['seal-app', 'seal-docs'], home)).toBe('/srv/seal-')
    expect(sharedFolderInput('/srv/seal-', '/srv', ['seal-app', 'seal-docs'], home)).toBeNull()
    expect(sharedFolderInput('/srv/', '/srv', ['app', 'docs'], home)).toBeNull()
  })
})

describe('suggestions while the machine is still answering', () => {
  const answered = {
    for: '/srv/s',
    matches: [{ name: 'seal' }, { name: 'Shared' }, { name: 'src' }]
  }

  it('narrows the previous answer as the same name grows', () => {
    expect(folderMatchesFor('/srv/s', answered)).toEqual(answered.matches)
    expect(folderMatchesFor('/srv/sh', answered)).toEqual([{ name: 'Shared' }])
  })

  it('drops the previous answer once another folder is being typed', () => {
    expect(folderMatchesFor('/srv/seal/', answered)).toEqual([])
    expect(folderMatchesFor('/s', answered)).toEqual([])
    expect(folderMatchesFor('/srv/s', null)).toEqual([])
  })
})
