// After a merge from upstream: rebrand the copy upstream added to in-place files, then rebuild
// every generated file from its sources (docs/upstream-sync.md). Idempotent.
import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { REGENERATE_SCRIPTS } from './generated-files.mjs'

for (const script of ['seal:rebrand-apply', ...REGENERATE_SCRIPTS]) {
  console.log(`> pnpm run ${script}`)
  const result = spawnSync('pnpm', ['run', '--silent', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
