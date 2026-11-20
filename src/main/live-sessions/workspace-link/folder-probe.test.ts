import { describe, expect, it } from 'vitest'
import { parseFolderProbe } from './folder-probe'

describe('parseFolderProbe', () => {
  it('keys a repository by the project its remotes name, upstream before origin, and by none when it has no remote', () => {
    const head = '@@HOME /home/b\n@@TMP \n@@ROOT /home/b/alpharidge-app\n'
    const origin =
      '@@REMOTE origin\tgit@github.com:acme/alpharidge-app.git (fetch)\n' +
      '@@REMOTE origin\tgit@github.com:acme/alpharidge-app.git (push)\n'
    const upstream = '@@REMOTE upstream\thttps://git.example.com/core/alpharidge.git (fetch)\n'

    expect(parseFolderProbe(`${head}${origin}@@DONE\n`)).toEqual({
      kind: 'repository',
      root: '/home/b/alpharidge-app',
      projectKey: 'github:acme/alpharidge-app',
      home: '/home/b',
      tmp: null
    })
    expect(parseFolderProbe(`${head}${origin}${upstream}@@DONE\n`)).toMatchObject({
      projectKey: 'git:git.example.com/core/alpharidge'
    })
    expect(parseFolderProbe(`${head}@@DONE\n`)).toEqual({
      kind: 'repository',
      root: '/home/b/alpharidge-app',
      home: '/home/b',
      tmp: null
    })
  })
})
