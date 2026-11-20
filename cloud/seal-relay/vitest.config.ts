import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Needs phone and host code: runs under test/security/audit-1/vitest.poc.config.ts.
    exclude: ['test/security/audit-1/phone-and-host-suites.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks'
  }
})
