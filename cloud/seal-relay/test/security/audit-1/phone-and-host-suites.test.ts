// Why an entry: the A1-03 and A1-04 suites import phone and host code, which loads only under
// vitest.poc.config.ts. The Worker's own config excludes this file; `pnpm test` runs both configs.
import './pairing-recovery-resume-token.poc'
import './registry-removal-open-session.poc'
