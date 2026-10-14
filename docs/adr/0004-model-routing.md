# 0004 — Model routing

**Status:** accepted · **Date:** 2026-10-02

## Context

The brief names OpenAI, Gemini and Claude. Organisations also have preferences of their own: an existing Azure OpenAI agreement, data-residency requirements, or cost targets. Providers have outages and rate limits.

## Decision

- **One interface, three official SDKs** (`@anthropic-ai/sdk`, `openai`, `@google/genai`), each reduced to a single operation: system + user prompt in, schema-valid object out.
- **Native structured output everywhere.** Claude via `output_config.format` with a Zod schema, OpenAI via `response_format` JSON schema, Gemini via `responseJsonSchema`. The result is validated against the same Zod schema again at our boundary regardless.
- **Two independent chains**, `AI_TRIAGE_ORDER` and `AI_DRAFT_ORDER`. Triage runs on every message and rewards latency and cost; drafting runs on a fraction and rewards writing quality in both languages. They need not use the same provider.
- **Fallback on failure.** On a timeout, rate limit, refusal or schema failure the next configured provider is tried, and every fall-through is logged against the message.
- **The offline engine is always last.** A bilingual lexical classifier and template drafter that needs no network. Its confidence is capped at 0.78, below the default auto-reply threshold, so mail it handled is never answered without a person.
- **Prompt caching.** System prompts are constants, with no dates or ids in them, so they form a cacheable prefix; the Claude call marks it explicitly.

### Claude specifics

Default model `claude-opus-5-5`, at **low effort**: triage and drafting are short, well-specified tasks. Server-side refusal fallback is enabled (`fallbacks: "default"`). Legal threats and phishing are exactly the mail that can trip a safety classifier, and a refusal should fall back to another model inside the same call rather than fail the message.

## Measuring instead of asserting

`npm run eval:triage` runs a labelled set through each configured provider and reports category accuracy, needs-reply accuracy and latency. The demo labels give the offline baseline: 91% category, 96% needs-reply on 23 messages. A real engagement replaces them with a few hundred of the client's own messages that a person has categorised, and chooses model and effort from the numbers.

## Consequences

- No provider is a single point of failure, and switching is configuration.
- Data-residency needs are met by configuration: Claude on Azure (Microsoft Foundry) or Azure OpenAI can be wired into the same interface.
