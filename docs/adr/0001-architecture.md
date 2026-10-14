# 0001 — Architecture

**Status:** accepted · **Date:** 2026-09-28

## Context

An agent acting on many Outlook mailboxes for a small organisation: tens of mailboxes, hundreds to low thousands of messages a day, an operator or two watching a console, and a hand-over to whoever runs it next. It must work in Outlook desktop and on the web, and it must be safe to leave running.

## Decision

One Next.js application, Node runtime, TypeScript end to end. It serves the console, receives Graph webhooks, runs the agent in-process from a keyed queue, and serves the Outlook add-in's task pane and API.

```
app/          routes, Server Actions, webhooks — no business rules
lib/agent     orchestration: load, ask the domain, act, log
lib/domain    pure rules — priority, guardrails, rules engine, folders, follow-ups
lib/ai        model providers behind one interface
lib/graph     Microsoft Graph and Entra ID
lib/store     state
```

Two rules hold the layering up:

- **`lib/domain` does no I/O.** Every decision that matters — what is urgent, what a rule does, whether a reply may be sent — is a pure function with tests. The pipeline test runs the whole agent against simulated mailboxes in under a second.
- **Only `lib/agent` writes to a mailbox.** A route that called Graph directly would eventually skip a guardrail or the activity log.

State is a JSON document written atomically. The mailbox is the system of record for mail; the store holds configuration, the agent's decisions and a working cache, and a resync rebuilds the cache.

## Alternatives considered

**n8n or Power Automate as the engine.** Both were named in the brief and both appear here — as *targets* of a signed webhook, not as the core. Rejected as the core because the hard parts of this problem are guardrails, prompt-injection containment, idempotency across duplicate webhooks, threading and bilingual drafting, and those are code-shaped, tested problems. A flow with fifty nodes and an AI step in the middle is difficult to test, to diff and to hand over. The webhook action gives an operator the flow tools for what they are good at: notifying Teams, creating a CRM record, opening a ticket.

**Python with a separate front end.** Equally capable for the AI work. Rejected for the hand-over: one language and one deploy, and the Office.js add-in is TypeScript regardless.

**An agent framework (LangChain, an autonomous tool-calling loop).** Rejected deliberately; see ADR 0002. The task is a fixed pipeline with two model calls, and making it a loop would hand the model control it should not have.

**Postgres from day one.** Right at scale, unnecessary for the demo and for a single-instance deployment of this size. The store is one module behind `mutate()` / `read`; moving to Postgres is replacing that module, and the trigger is stated: more than one instance, or more than a few thousand messages a day.

## Consequences

- `npm run dev` runs the whole system with no database, no tenant and no keys.
- One process means the queue and the live event bus are in memory. Horizontal scaling needs a shared queue and a shared bus; both are already interfaces.
- The worker starts from `instrumentation.ts`. Serverless hosts that freeze idle processes are a poor fit; a container or an App Service plan is the intended host.
