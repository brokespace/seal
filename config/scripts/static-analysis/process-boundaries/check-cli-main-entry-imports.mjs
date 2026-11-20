import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CLI_MAIN_ENTRY_NAMES } from '../../../build-plugins/cli-main-entry-names.ts'
import { collectProcessHostSources } from './check-process-host-imports.mjs'
import { collectModuleSpecifiers } from '../module-requests/static-module-specifiers.mjs'
import { isTestOnlySourcePath } from './test-only-source-path.mjs'

const CLI_SOURCE = 'src/cli/'
const MAIN_SOURCE = 'src/main/'

// electron-vite replaces out/main after the CLI is emitted, so the packaged CLI finds only registered entries there.
export function assessCliMainEntryImports(sources, entryNames = CLI_MAIN_ENTRY_NAMES) {
  const entries = new Set(entryNames.map((name) => `${MAIN_SOURCE}${name}`))
  const violations = []
  for (const [file, contents] of sources) {
    if (!file.startsWith(CLI_SOURCE) || isTestOnlySourcePath(file)) {
      continue
    }
    for (const specifier of collectModuleSpecifiers(file, contents, { runtimeOnly: true })) {
      if (!specifier.startsWith('.')) {
        continue
      }
      const target = path.posix
        .normalize(path.posix.join(path.posix.dirname(file), specifier.replaceAll('\\', '/')))
        .replace(/\.[cm]?[jt]sx?$/, '')
      if (target.startsWith(MAIN_SOURCE) && !entries.has(target)) {
        const name = target.slice(MAIN_SOURCE.length)
        violations.push(
          `${file}: the packaged CLI cannot load ${specifier}; add '${name}' to CLI_MAIN_ENTRY_NAMES and out/main/${name}.js to the electron-builder files, or move the code to src/shared`
        )
      }
    }
  }
  return violations.sort()
}

export function main(root, sharedSources) {
  const violations = assessCliMainEntryImports(sharedSources ?? collectProcessHostSources(root))
  if (violations.length > 0) {
    console.error(`[cli-main-entry-imports]\n${violations.join('\n')}`)
    return 1
  }
  console.log(`[cli-main-entry-imports] ok; ${CLI_MAIN_ENTRY_NAMES.length} registered entries`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main()
}
