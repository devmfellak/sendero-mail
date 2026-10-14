import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import * as z from 'zod/v4'
import { env } from '../env'
import { DraftSchema, TriageSchema } from './schema'
import type { ModelProvider, ProviderId, StructuredCall } from './types'

/**
 * The three hosted providers, each through its official SDK, each reduced to
 * the same single operation: system + user in, schema-valid object out.
 *
 * Structured output is requested natively from all three rather than by
 * "please answer in JSON", so a malformed response is the provider's failure
 * (and is retried down the chain) rather than a parser's guess. The result is
 * validated against the Zod schema again regardless — a provider's guarantee
 * is not a reason to skip the check at our boundary.
 */

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
    readonly retryable: boolean,
  ) {
    super(`${provider}: ${message}`)
  }
}

function fromStructured(id: ProviderId, model: string, configured: () => boolean, call: StructuredCall): ModelProvider {
  return {
    id,
    model,
    configured,
    triage: (input, signal) =>
      call({ system: input.system, user: input.user, schema: TriageSchema, name: 'triage', maxTokens: 2_000 }, signal),
    draft: (input, signal) =>
      call({ system: input.system, user: input.user, schema: DraftSchema, name: 'draft', maxTokens: 4_000 }, signal),
  }
}

/* ------------------------------------------------------------- Claude -- */

export function anthropicProvider(): ModelProvider {
  const e = env()
  let client: Anthropic | null = null

  const call: StructuredCall = async (req, signal) => {
    client ??= new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 2 })
    let response
    try {
      response = await client.beta.messages.parse(
        {
          model: e.ANTHROPIC_MODEL,
          max_tokens: req.maxTokens,
          // Triage and drafting are short, well-specified tasks; low effort
          // keeps latency down without measurable loss on this workload
          // (see scripts/eval-triage.ts to re-measure on your own mail).
          output_config: { effort: 'low', format: betaZodOutputFormat(req.schema) },
          // If a safety classifier declines (legal threats and phishing are
          // exactly the mail that can trip one), the API re-runs the request on
          // a fallback model inside the same call instead of failing it.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: req.user }],
        },
        { signal },
      )
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError('anthropic', 'rate limited', true)
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderError('anthropic', 'invalid API key', false)
      if (err instanceof Anthropic.BadRequestError) throw new ProviderError('anthropic', err.message, false)
      if (err instanceof Anthropic.APIError) throw new ProviderError('anthropic', `API error ${err.status}`, true)
      throw err
    }

    if (response.stop_reason === 'refusal') {
      throw new ProviderError('anthropic', `declined (${response.stop_details?.category ?? 'unspecified'})`, false)
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ProviderError('anthropic', 'response truncated', true)
    }
    if (!response.parsed_output) throw new ProviderError('anthropic', 'no structured output', true)
    return req.schema.parse(response.parsed_output)
  }

  return fromStructured('anthropic', e.ANTHROPIC_MODEL, () => Boolean(e.ANTHROPIC_API_KEY), call)
}

/* ------------------------------------------------------------- OpenAI -- */

export function openaiProvider(): ModelProvider {
  const e = env()
  let client: OpenAI | null = null

  const call: StructuredCall = async (req, signal) => {
    client ??= new OpenAI({ apiKey: e.OPENAI_API_KEY, maxRetries: 2 })
    let completion
    try {
      completion = await client.chat.completions.parse(
        {
          model: e.OPENAI_MODEL,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          response_format: zodResponseFormat(req.schema, req.name),
        },
        { signal },
      )
    } catch (err) {
      if (err instanceof OpenAI.RateLimitError) throw new ProviderError('openai', 'rate limited', true)
      if (err instanceof OpenAI.AuthenticationError) throw new ProviderError('openai', 'invalid API key', false)
      if (err instanceof OpenAI.APIError) throw new ProviderError('openai', `API error ${err.status}`, true)
      throw err
    }

    const message = completion.choices[0]?.message
    if (message?.refusal) throw new ProviderError('openai', 'declined', false)
    if (!message?.parsed) throw new ProviderError('openai', 'no structured output', true)
    return req.schema.parse(message.parsed)
  }

  return fromStructured('openai', e.OPENAI_MODEL, () => Boolean(e.OPENAI_API_KEY), call)
}

/* ------------------------------------------------------------- Gemini -- */

export function geminiProvider(): ModelProvider {
  const e = env()
  let client: GoogleGenAI | null = null

  const call: StructuredCall = async (req, signal) => {
    client ??= new GoogleGenAI({ apiKey: e.GEMINI_API_KEY })
    let text: string | undefined
    try {
      const response = await client.models.generateContent({
        model: e.GEMINI_MODEL,
        contents: req.user,
        config: {
          systemInstruction: req.system,
          responseMimeType: 'application/json',
          responseJsonSchema: z.toJSONSchema(req.schema),
          maxOutputTokens: req.maxTokens,
          abortSignal: signal,
        },
      })
      text = response.text
    } catch (err) {
      const status = (err as { status?: number }).status
      throw new ProviderError('gemini', status ? `API error ${status}` : String(err), status !== 400 && status !== 403)
    }

    if (!text) throw new ProviderError('gemini', 'empty response', true)
    try {
      return req.schema.parse(JSON.parse(text))
    } catch {
      throw new ProviderError('gemini', 'response did not match schema', true)
    }
  }

  return fromStructured('gemini', e.GEMINI_MODEL, () => Boolean(e.GEMINI_API_KEY), call)
}
