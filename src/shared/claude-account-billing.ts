/**
 * What Anthropic says about a Claude login, as Claude Code records it:
 * `organization.*` from `/api/oauth/profile`, `claudeAiOauth.*` in the credentials and
 * `oauthAccount.*` in `.claude.json`.
 */
export type ClaudeBillingSignals = {
  /** Profile `organization.organization_type`: claude_pro, claude_max, claude_team, claude_enterprise. */
  organizationType?: string | null
  /** Credentials `subscriptionType`: pro, max, team, enterprise. */
  subscriptionType?: string | null
  /** Profile `rate_limit_tier` / credentials `rateLimitTier`, e.g. default_claude_max_20x. */
  rateLimitTier?: string | null
  /** Profile `billing_type` / `oauthAccount.billingType`, e.g. stripe_subscription. */
  billingType?: string | null
  /** OAuth scopes the login was granted. */
  scopes?: readonly string[] | null
  /** The login runs on an API key rather than an OAuth token. */
  apiKey?: boolean
}

export type ClaudeBillingKind = 'subscription' | 'api'
export type ClaudePlan = 'pro' | 'max' | 'team' | 'enterprise'

export type ClaudeAccountBilling = {
  /** Null when nothing says how the login is billed; never guessed. */
  kind: ClaudeBillingKind | null
  plan: ClaudePlan | null
  /** Plan name to show, e.g. "Max 20x" or "Team". */
  label: string | null
}

const PLANS: readonly ClaudePlan[] = ['pro', 'max', 'team', 'enterprise']
const PLAN_LABEL: Record<ClaudePlan, string> = {
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise'
}
/** The scope Claude Code itself treats as "this login is a Claude subscription". */
const SUBSCRIPTION_SCOPE = 'user:inference'
/** Granted to Console logins, which mint an API key instead of running on the login. */
const CONSOLE_SCOPE = 'org:create_api_key'

function clean(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function planOf(signals: ClaudeBillingSignals): ClaudePlan | null {
  const organizationType = clean(signals.organizationType)
  const named = organizationType.startsWith('claude_')
    ? organizationType.slice('claude_'.length)
    : clean(signals.subscriptionType)
  const plan = PLANS.find((candidate) => candidate === named)
  if (plan) {
    return plan
  }
  // A Max seat names its plan in the tier even where the plan fields are absent.
  return /^default_claude_max(_|$)/.test(clean(signals.rateLimitTier)) ? 'max' : null
}

function labelOf(plan: ClaudePlan, signals: ClaudeBillingSignals): string {
  const multiplier = clean(signals.rateLimitTier).match(/max_(\d+)x/)?.[1]
  return multiplier ? `${PLAN_LABEL[plan]} ${multiplier}x` : PLAN_LABEL[plan]
}

function hasSubscriptionSignal(signals: ClaudeBillingSignals): boolean {
  return (
    clean(signals.organizationType).startsWith('claude_') ||
    Boolean(signals.scopes?.includes(SUBSCRIPTION_SCOPE)) ||
    clean(signals.rateLimitTier).startsWith('default_claude') ||
    clean(signals.billingType).includes('subscription')
  )
}

function hasApiSignal(signals: ClaudeBillingSignals): boolean {
  const organizationType = clean(signals.organizationType)
  return (
    signals.apiKey === true ||
    Boolean(signals.scopes?.includes(CONSOLE_SCOPE)) ||
    (organizationType !== '' && !organizationType.startsWith('claude_'))
  )
}

/**
 * A login on a Pro, Max, Team or Enterprise organization is a subscription, whatever else it
 * carries. API billing needs its own evidence: an API key, or a Console organization.
 */
export function classifyClaudeBilling(signals: ClaudeBillingSignals): ClaudeAccountBilling {
  const plan = planOf(signals)
  if (plan) {
    return { kind: 'subscription', plan, label: labelOf(plan, signals) }
  }
  if (hasSubscriptionSignal(signals)) {
    return { kind: 'subscription', plan: null, label: null }
  }
  return { kind: hasApiSignal(signals) ? 'api' : null, plan: null, label: null }
}

/** Later sources fill only what earlier ones left out. */
export function mergeClaudeBillingSignals(
  ...sources: (ClaudeBillingSignals | null | undefined)[]
): ClaudeBillingSignals {
  const merged: ClaudeBillingSignals = {}
  for (const source of sources) {
    if (!source) {
      continue
    }
    merged.organizationType ??= source.organizationType || undefined
    merged.subscriptionType ??= source.subscriptionType || undefined
    merged.rateLimitTier ??= source.rateLimitTier || undefined
    merged.billingType ??= source.billingType || undefined
    merged.scopes ??= source.scopes?.length ? source.scopes : undefined
    merged.apiKey ??= source.apiKey
  }
  return merged
}
