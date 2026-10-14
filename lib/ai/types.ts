import type * as z from 'zod/v4'
import type { CategoryKey, Language } from '../types'
import type { DraftOutput, TriageOutput } from './schema'

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'offline'

/**
 * The two jobs a model does here, each with two views of the same input:
 * the rendered prompts that a language model reads, and the raw fields the
 * offline engine works from. A provider uses whichever it understands.
 */
export interface TriageInput {
  system: string
  user: string
  raw: {
    subject: string
    focus: string
    from: string
    headers: Record<string, string>
    receivedAt: string
    internalSender: boolean
  }
}

export interface DraftInput {
  system: string
  user: string
  raw: {
    language: Language
    subject: string
    focus: string
    senderName: string
    signature: string
    knowledge: string
    category: CategoryKey
    instructions?: string
  }
}

export interface ModelProvider {
  readonly id: ProviderId
  readonly model: string
  configured(): boolean
  triage(input: TriageInput, signal: AbortSignal): Promise<TriageOutput>
  draft(input: DraftInput, signal: AbortSignal): Promise<DraftOutput>
}

/** What every network provider needs to implement: one structured call. */
export type StructuredCall = <S extends z.ZodType>(
  req: { system: string; user: string; schema: S; name: string; maxTokens: number },
  signal: AbortSignal,
) => Promise<z.infer<S>>
