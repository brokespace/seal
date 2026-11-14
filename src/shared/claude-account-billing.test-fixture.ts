/**
 * Claude logins as Claude Code stores and Anthropic reports them, one per kind of account:
 * `credentials` is `.credentials.json` (or the Keychain item), `oauthAccount` is the block in
 * `.claude.json`, and `profile` is the `/api/oauth/profile` response. Tokens are placeholders.
 * Plan values (`claude_*`, `subscriptionType`, the Max tiers) are Claude Code's own; the Team
 * tier and the Console organization's values stand in for ones Anthropic does not document.
 */
type ClaudeOAuthProfileFixture = {
  account: { uuid: string; email: string; display_name: string }
  organization: {
    uuid: string
    organization_type: string
    rate_limit_tier: string
    billing_type: string
    has_extra_usage_enabled: boolean
  }
}

export type ClaudeSubscriberLoginFixture = {
  credentials: {
    claudeAiOauth: {
      accessToken: string
      refreshToken: string
      expiresAt: number
      scopes: string[]
      subscriptionType: string | null
      rateLimitTier: string
    }
  }
  oauthAccount: { emailAddress: string; organizationName: string; billingType: string } & Record<
    string,
    unknown
  >
  profile: ClaudeOAuthProfileFixture
}

const SUBSCRIBER_SCOPES = ['user:inference', 'user:profile', 'user:sessions:claude_code']

function subscriber(args: {
  email: string
  organizationName: string
  organizationType: string
  subscriptionType: string | null
  rateLimitTier: string
  billingType: string
  organizationRole?: string
}): ClaudeSubscriberLoginFixture {
  return {
    credentials: {
      claudeAiOauth: {
        accessToken: `fixture-access-${args.organizationType}`,
        refreshToken: `fixture-refresh-${args.organizationType}`,
        expiresAt: 1_900_000_000_000,
        scopes: SUBSCRIBER_SCOPES,
        subscriptionType: args.subscriptionType,
        rateLimitTier: args.rateLimitTier
      }
    },
    oauthAccount: {
      accountUuid: '11111111-1111-4111-8111-111111111111',
      emailAddress: args.email,
      organizationUuid: '22222222-2222-4222-8222-222222222222',
      organizationName: args.organizationName,
      organizationRole: args.organizationRole ?? 'admin',
      workspaceRole: null,
      displayName: 'Fixture User',
      hasExtraUsageEnabled: false,
      billingType: args.billingType
    },
    profile: {
      account: {
        uuid: '11111111-1111-4111-8111-111111111111',
        email: args.email,
        display_name: 'Fixture User'
      },
      organization: {
        uuid: '22222222-2222-4222-8222-222222222222',
        organization_type: args.organizationType,
        rate_limit_tier: args.rateLimitTier,
        billing_type: args.billingType,
        has_extra_usage_enabled: false
      }
    }
  }
}

const consoleProfile: ClaudeOAuthProfileFixture = {
  account: {
    uuid: '33333333-3333-4333-8333-333333333333',
    email: 'dev@console.example',
    display_name: 'Fixture Developer'
  },
  organization: {
    uuid: '44444444-4444-4444-8444-444444444444',
    organization_type: 'api',
    rate_limit_tier: 'auto_prepaid_tier_2',
    billing_type: 'prepaid',
    has_extra_usage_enabled: false
  }
}

export const CLAUDE_LOGIN_FIXTURES = {
  personalPro: subscriber({
    email: 'pro@example.com',
    organizationName: "pro@example.com's Organization",
    organizationType: 'claude_pro',
    subscriptionType: 'pro',
    rateLimitTier: 'default_claude_ai',
    billingType: 'stripe_subscription'
  }),
  personalMax5x: subscriber({
    email: 'max5@example.com',
    organizationName: "max5@example.com's Organization",
    organizationType: 'claude_max',
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_5x',
    billingType: 'stripe_subscription'
  }),
  personalMax20x: subscriber({
    email: 'max20@example.com',
    organizationName: "max20@example.com's Organization",
    organizationType: 'claude_max',
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_20x',
    billingType: 'stripe_subscription'
  }),
  team: subscriber({
    email: 'seat@team.example',
    organizationName: 'team.example',
    organizationType: 'claude_team',
    subscriptionType: 'team',
    rateLimitTier: 'default_raven',
    billingType: 'stripe_subscription',
    organizationRole: 'user'
  }),
  enterprise: subscriber({
    email: 'seat@enterprise.example',
    organizationName: 'enterprise.example',
    organizationType: 'claude_enterprise',
    subscriptionType: 'enterprise',
    rateLimitTier: 'default_claude_enterprise',
    billingType: 'stripe_subscription_contracted',
    organizationRole: 'user'
  }),
  /** A seat whose credentials predate the plan fields: only the organization names the plan. */
  teamWithoutSavedPlan: subscriber({
    email: 'seat@team.example',
    organizationName: 'team.example',
    organizationType: 'claude_team',
    subscriptionType: null,
    rateLimitTier: 'default_raven',
    billingType: 'stripe_subscription',
    organizationRole: 'user'
  }),
  /** A Console login: no inference token, just the API key it minted. */
  consoleApi: {
    credentials: {},
    oauthAccount: {
      accountUuid: '33333333-3333-4333-8333-333333333333',
      emailAddress: 'dev@console.example',
      organizationUuid: '44444444-4444-4444-8444-444444444444',
      organizationName: 'console.example',
      organizationRole: 'developer',
      workspaceRole: 'workspace_developer',
      billingType: 'prepaid'
    },
    profile: consoleProfile,
    primaryApiKey: 'fixture-console-api-key'
  },
  /** `ANTHROPIC_API_KEY` only: nobody signed in. */
  apiKeyOnly: { credentials: {}, oauthAccount: null, profile: null }
}
