import { describe } from 'vitest'

// These suites pass while the reported weakness exists, so a fix makes them fail by design.
// Run them with: SEAL_SECURITY_POC=1 pnpm test test/security/audit-1
export const describePoc = process.env.SEAL_SECURITY_POC === '1' ? describe : describe.skip
