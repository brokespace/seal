import { it } from 'vitest'

// Why an entry: the A1-03 and A1-04 suites import phone and host code, which loads only under
// vitest.poc.config.ts, so the Worker's own config collects this file and must not import them.
if (
  process.env.SEAL_SECURITY_POC === '1' &&
  process.env.SEAL_SECURITY_POC_CONFIG === 'phone-and-host'
) {
  await import('./pairing-recovery-resume-token.poc')
  await import('./registry-removal-open-session.poc')
} else {
  it.skip('audit 1 A1-03 and A1-04: need SEAL_SECURITY_POC=1 and --config test/security/audit-1/vitest.poc.config.ts', () => {})
}
