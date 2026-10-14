import { env } from '../env'
import { offlineProvider } from './offline'
import { anthropicProvider, geminiProvider, openaiProvider, ProviderError } from './providers'
import { normaliseDraft, normaliseTriage, type DraftOutput, type TriageOutput } from './schema'
import type { DraftInput, ModelProvider, ProviderId, TriageInput } from './types'

/**
 * Model routing.
 *
 * Each task has an ordered provider chain (`AI_TRIAGE_ORDER`, `AI_DRAFT_ORDER`).
 * The first configured provider is tried; on a timeout, rate limit, refusal or
 * schema failure the next one is, and the offline engine is always last. Mail
 * keeps flowing through a provider outage — with lower confidence, which the
 * guardrails then respect by holding replies for review.
 *
 * Triage and drafting are routed independently because they reward different
 * things: triage runs on every message and wants low latency and cost;
 * drafting runs on a fraction and wants the best writing in both languages.
 */

export interface Routed<T> {
  data: T
  provider: ProviderId
  model: string
  latencyMs: number
  /** Providers that were tried and failed first, with why. */
  failures: Array<{ provider: ProviderId; error: string }>
}

let registry: Record<ProviderId, ModelProvider> | null = null

export function providers(): Record<ProviderId, ModelProvider> {
  registry ??= {
    anthropic: anthropicProvider(),
    openai: openaiProvider(),
    gemini: geminiProvider(),
    offline: offlineProvider(),
  }
  return registry
}

/** Tests swap in fakes. */
export function setProviders(next: Record<ProviderId, ModelProvider> | null): void {
  registry = next
}

export function chainFor(task: 'triage' | 'draft'): ModelProvider[] {
  const order = task === 'triage' ? env().AI_TRIAGE_ORDER : env().AI_DRAFT_ORDER
  const all = providers()
  const ids = order
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ProviderId => s in all)
  if (!ids.includes('offline')) ids.push('offline')
  return [...new Set(ids)].map((id) => all[id]).filter((p) => p.configured())
}

export async function routeTriage(input: TriageInput): Promise<Routed<TriageOutput>> {
  return route('triage', (p, signal) => p.triage(input, signal).then(normaliseTriage))
}

export async function routeDraft(input: DraftInput): Promise<Routed<DraftOutput>> {
  return route('draft', (p, signal) => p.draft(input, signal).then(normaliseDraft))
}

async function route<T>(
  task: 'triage' | 'draft',
  run: (p: ModelProvider, signal: AbortSignal) => Promise<T>,
): Promise<Routed<T>> {
  const failures: Routed<T>['failures'] = []
  const timeoutMs = env().AI_TIMEOUT_MS

  for (const provider of chainFor(task)) {
    const started = Date.now()
    const signal = AbortSignal.timeout(provider.id === 'offline' ? 5_000 : timeoutMs)
    try {
      const data = await run(provider, signal)
      return { data, provider: provider.id, model: provider.model, latencyMs: Date.now() - started, failures }
    } catch (err) {
      failures.push({ provider: provider.id, error: describe(err) })
    }
  }

  throw new Error(`Every provider failed for ${task}: ${failures.map((f) => `${f.provider} (${f.error})`).join('; ')}`)
}

function describe(err: unknown): string {
  if (err instanceof ProviderError) return err.message.replace(`${err.provider}: `, '')
  if (err instanceof Error && err.name === 'TimeoutError') return 'timed out'
  if (err instanceof Error) return err.message.slice(0, 200)
  return String(err)
}
