import { expect, it } from 'vitest'
import { assessCliMainEntryImports } from './check-cli-main-entry-imports.mjs'

it('rejects a CLI runtime import of a main module that is not a registered entry', () => {
  const sources = new Map([
    [
      'src/cli/devices/paired-devices.ts',
      [
        "import type { Row } from '../../main/devices/row'",
        "import { lock } from '../../main/orcad/lock.js'",
        "export const load = () => import('../../main/devices/under-lock.js')"
      ].join('\n')
    ],
    ['src/main/devices/consumer.ts', "import { row } from './row'"]
  ])
  expect(assessCliMainEntryImports(sources, ['orcad/lock'])).toEqual([
    "src/cli/devices/paired-devices.ts: the packaged CLI cannot load ../../main/devices/under-lock.js; add 'devices/under-lock' to CLI_MAIN_ENTRY_NAMES and out/main/devices/under-lock.js to the electron-builder files, or move the code to src/shared"
  ])
})
