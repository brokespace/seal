import { sourceKey } from '../../../cloud/apps/relay-edge/src/preauth'

/**
 * One request against a Rate Limiting binding, keyed by the caller's address (an IPv6 caller by
 * its /64, which one subscriber holds whole). A deploy without the binding, or a limiter that
 * cannot answer, admits nobody: these gates are the only bound on anonymous work.
 */
export async function admitSource(
  limiter: RateLimit | undefined,
  request: Request,
  scope = ''
): Promise<boolean> {
  return admitKey(limiter, `${scope}${sourceKey(request)}`)
}

export async function admitKey(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) {
    return false
  }
  try {
    return (await limiter.limit({ key })).success
  } catch {
    return false
  }
}
