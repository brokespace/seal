import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const repoRoot = resolve(import.meta.dirname, '../../../../..')

// For the *.poc.ts suites, which import phone and host code the Worker's own tests do not:
// mobile/tsconfig.json extends an Expo base config that is not installed here, so esbuild gets an
// inline one, and the host's workspace package and build-time constants are supplied directly.
// Run from cloud/seal-relay:
//   SEAL_SECURITY_POC=1 pnpm exec vitest run --config test/security/audit-1/vitest.poc.config.ts
export default defineConfig({
  define: {
    ORCA_FEATURE_WALL_ENABLED: 'true',
    ORCA_BUILD_COMMIT: JSON.stringify('0'.repeat(40))
  },
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        useDefineForClassFields: true,
        verbatimModuleSyntax: false
      }
    })
  },
  resolve: {
    alias: [
      {
        find: /^@orca\/process-host$/,
        replacement: resolve(repoRoot, 'src/packages/process-host/src/run-process.ts')
      },
      {
        find: /^@orca\/process-host\/(.*)$/,
        replacement: resolve(repoRoot, 'src/packages/process-host/src/$1.ts')
      },
      { find: '@renderer', replacement: resolve(repoRoot, 'src/renderer/src') }
    ]
  },
  test: {
    include: ['test/security/audit-1/**/*.poc.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    env: { ORCA_VITEST_RUNTIME: 'node', ORCA_WSL_HOSTS_GATE_STATE: '' },
    server: { deps: { inline: ['zod'] } }
  }
})
