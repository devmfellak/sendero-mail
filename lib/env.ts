import * as z from 'zod/v4'

/**
 * Configuration, parsed once.
 *
 * Every variable is optional, because the default deployment is the demo: no
 * Microsoft tenant, no model keys, simulated mailboxes and the offline
 * classifier. Each real integration switches on when its variables are
 * present, and the settings page reports exactly which ones are live — a
 * misconfigured key is a visible state, not a mystery.
 */

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v?.toLowerCase() === 'true')

const Schema = z.object({
  APP_ORIGIN: z.string().default('http://localhost:3000'),
  /** Serverless hosts allow writes only under /tmp. */
  DATA_DIR: z.string().default(process.env.VERCEL ? '/tmp/sendero' : '.data'),
  /** Times in the dashboard are shown in one zone so two operators see the same thing. */
  DISPLAY_TIME_ZONE: z.string().default('America/Mexico_City'),

  // Microsoft Entra ID / Graph
  MS_TENANT_ID: z.string().default('organizations'),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  /** Public https origin Graph can reach for change notifications. */
  GRAPH_NOTIFICATION_ORIGIN: z.string().optional(),
  /** 32 bytes, base64. Encrypts refresh tokens at rest. */
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  // Models
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  AI_TRIAGE_ORDER: z.string().default('anthropic,openai,gemini,offline'),
  AI_DRAFT_ORDER: z.string().default('anthropic,openai,gemini,offline'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),

  /** HMAC key for outbound rule webhooks (n8n, Power Automate, Zapier). */
  WEBHOOK_SIGNING_SECRET: z.string().optional(),

  // Dashboard access (HTTP Basic until SSO is wired to a tenant)
  DASHBOARD_USER: z.string().optional(),
  DASHBOARD_PASSWORD: z.string().optional(),

  // Demo
  SIMULATOR: bool,
  SIMULATOR_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(75),
})

export type Env = z.infer<typeof Schema>

let cached: Env | null = null

export function env(): Env {
  if (!cached) cached = Schema.parse(process.env)
  return cached
}

/** Tests change process.env between cases. */
export function resetEnv(): void {
  cached = null
}

export function graphConfigured(): boolean {
  const e = env()
  return Boolean(e.MS_CLIENT_ID && e.MS_CLIENT_SECRET && e.TOKEN_ENCRYPTION_KEY)
}

export function simulatorEnabled(): boolean {
  // On by default when there is no tenant to receive real mail from.
  const raw = process.env.SIMULATOR
  return raw === undefined ? !graphConfigured() : env().SIMULATOR
}
