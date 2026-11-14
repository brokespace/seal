/**
 * Responses in the shape `GET https://api.anthropic.com/api/oauth/usage` gives a Claude
 * subscription login, for four accounts on one machine at one moment.
 */
export type FakeUsageResponse = {
  status: number
  headers?: Record<string, string>
  body: unknown
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function window(utilization: number, resetsAt: number): { utilization: number; resets_at: string } {
  return { utilization, resets_at: new Date(resetsAt).toISOString() }
}

function usage(
  now: number,
  fiveHour: { utilization: number; resetsInMs: number },
  sevenDay: { utilization: number; resetsInMs: number },
  sonnet: number | null = null
): FakeUsageResponse {
  return {
    status: 200,
    body: {
      five_hour: window(fiveHour.utilization, now + fiveHour.resetsInMs),
      seven_day: window(sevenDay.utilization, now + sevenDay.resetsInMs),
      seven_day_oauth_apps: null,
      seven_day_opus: null,
      seven_day_sonnet: sonnet === null ? null : window(sonnet, now + sevenDay.resetsInMs),
      extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null }
    }
  }
}

/** A login with plenty of room in both windows. */
export function claudeUsageWithRoom(now: number): FakeUsageResponse {
  return usage(
    now,
    { utilization: 34, resetsInMs: 2 * HOUR + 10 * MINUTE },
    { utilization: 61, resetsInMs: 4 * DAY },
    12
  )
}

/** Close to the 5-hour limit, but still serving requests. */
export function claudeUsageNearLimit(now: number): FakeUsageResponse {
  return usage(
    now,
    { utilization: 93, resetsInMs: 48 * MINUTE },
    { utilization: 78, resetsInMs: 2 * DAY + 6 * HOUR }
  )
}

/** Out of quota: the 5-hour window is full until it resets. */
export function claudeUsageAtLimit(now: number): FakeUsageResponse {
  return usage(
    now,
    { utilization: 100, resetsInMs: HOUR + 47 * MINUTE },
    { utilization: 88, resetsInMs: 5 * DAY }
  )
}

/** The usage endpoint refusing the check itself; the account's own quota is untouched. */
export function claudeUsageCheckThrottled(retryAfterSeconds = 300): FakeUsageResponse {
  return {
    status: 429,
    headers: { 'retry-after': String(retryAfterSeconds) },
    body: {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' }
    }
  }
}

/** A login the provider no longer accepts. */
export function claudeUsageLoginRevoked(): FakeUsageResponse {
  return {
    status: 401,
    body: {
      type: 'error',
      error: { type: 'authentication_error', message: 'OAuth token has been revoked.' }
    }
  }
}
