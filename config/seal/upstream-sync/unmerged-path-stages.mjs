// Reads the three sides of each unmerged path during a merge, and redoes a three-way merge on
// texts the caller has normalized first.
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 30 })
}

/** Unmerged paths with the blob id of each side: 1 base, 2 ours, 3 theirs. */
export function readUnmergedStages(root) {
  const byPath = new Map()
  for (const entry of git(root, ['ls-files', '--unmerged', '-z']).split('\0')) {
    const match = /^\d+ ([0-9a-f]+) ([123])\t(.+)$/s.exec(entry)
    if (match) {
      const stages = byPath.get(match[3]) ?? {}
      stages[match[2]] = match[1]
      byPath.set(match[3], stages)
    }
  }
  return byPath
}

export function blobText(root, id) {
  return id ? git(root, ['cat-file', 'blob', id]) : null
}

/** `labels` name ours, base and theirs in any conflict markers left in the result. */
export function mergeThreeWay(scratch, { ours, base, theirs }, labels) {
  const paths = ['ours', 'base', 'theirs'].map((name) => join(scratch, name))
  ;[ours, base, theirs].forEach((text, index) => writeFileSync(paths[index], text))
  const result = spawnSync(
    'git',
    ['merge-file', '-p', ...labels.flatMap((label) => ['-L', label]), ...paths],
    { encoding: 'utf8', maxBuffer: 2 ** 30 }
  )
  return { text: result.stdout, conflicts: result.status }
}
