import { describe } from 'vitest'

// These suites assert that an attack works today, so a later fix makes them fail by design.
// Run them with: SEAL_SECURITY_POC=1 pnpm test test/security
export const describePoc = process.env.SEAL_SECURITY_POC === '1' ? describe : describe.skip
