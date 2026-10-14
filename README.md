# Sendero

An AI email agent for Microsoft 365. It watches many Outlook mailboxes at once, reads and prioritises every message, files it into folders it creates, drafts replies in English or Spanish, sends the ones that are safe to send, and keeps track of every conversation where somebody is waiting.

Everything it does happens *in the mailbox*: folders in Outlook's folder pane, colour categories, flags, and reply drafts in Drafts that can be finished from Outlook desktop, Outlook on the web or a phone. The console is where people see what it did and approve what it held back.

Next.js 15 · React 19 · TypeScript (strict) · Microsoft Graph · Entra ID OAuth 2.0 · Claude, OpenAI and Gemini through their official SDKs · Office.js add-in. No UI kit, no CSS framework, no agent framework.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

No keys required. The first run creates three simulated mailboxes for a fictional bilingual freight company, a starter rule set, and a backlog of mail — phishing, a prompt-injection attempt, a legal markup, an urgent Spanish request from a VIP client, newsletters, threads — that the agent works through live while the page is open. A new email arrives every 75 seconds, or press **Simulate new email**.

Add any model key to `.env.local` (see `.env.example`) and the next message is classified and drafted by that model instead of the offline engine. Add an Entra app registration and real Outlook mailboxes connect alongside the demo ones — `docs/RUNBOOK.md` walks through it.

### Deploying to Vercel

```bash
npx vercel           # first run links the project; accept the detected Next.js settings
npx vercel --prod
```

Or import the repository at vercel.com/new. No environment variables are required for the sample workspace. On Vercel the app adapts to a serverless host by itself: state is kept under `/tmp` (rebuilt from the seed on each cold start), the backlog is processed before the first request is served, sample mail arrives as pages are viewed rather than on a timer, and the console refreshes on an interval instead of holding an event stream open. Add `ANTHROPIC_API_KEY` (or an OpenAI / Gemini key) to have drafts written by a model; add `DASHBOARD_USER` / `DASHBOARD_PASSWORD` to put the console behind a password.

For a deployment with real mailboxes, state needs to outlive an instance: run it on a long-lived Node host, or move the store to Postgres (ADR 0001).

```bash
npm test             # 99 tests: rules, guardrails, Graph, the full pipeline
npm run typecheck
npm run eval:triage  # accuracy of each configured model on labelled mail
npm run build
```

---

## The brief, and where each part lives

| Requirement | Implementation |
| --- | --- |
| **Many mailboxes, in real time** | One queue, serial per mailbox and parallel across them (`lib/agent/queue.ts`) — Outlook throttles per mailbox, and one busy inbox must not delay the rest. New mail arrives through Graph change notifications within seconds; a delta-query reconciliation every 15 minutes catches anything a notification missed (`lib/graph/sync.ts`). |
| **Read, analyse, prioritise, categorise** | A model classifies into a fixed 13-category taxonomy and reports urgency, deadline, tone and what is being asked. Priority is then *computed*, not guessed: category base + urgency + VIP sender + deadline proximity + direct-vs-copied + bulk-mail signals, each kept as a labelled factor so the console can say **why** something is urgent (`lib/domain/priority.ts`). |
| **Create folders and subfolders** | Rules file into templated paths — `Clients/{senderOrg}`, `Tickets/{year}-{month}`, `Leads/{language}`. Missing levels are created one at a time through Graph, in order, idempotently, and a folder created in Outlook mid-run is adopted rather than duplicated (`lib/domain/folders.ts`, `lib/agent/executor.ts`). |
| **Move emails into folders** | Graph `move`, with immutable ids requested so links in the console survive the move. Filing runs last in each plan, after flags, categories and drafts. |
| **AI-written replies** | Drafted with the thread as context (quoted history stripped and rebuilt from the messages themselves), the mailbox's own knowledge base, tone and signature. Placed in Outlook's Drafts folder through `createReply`, so it is threaded and quotes the original exactly as Outlook would. |
| **Draft or auto-send by rule** | A rule asks for `draftReply` or `autoReply`. An automatic reply is sent only if it passes every guardrail — mode, category, confidence, quiet hours, rate limit, loop prevention, prompt-injection, and a check that every link, phone number and amount in it appears in the thread or knowledge base. Otherwise it waits in **Approvals**, listing every reason (`lib/domain/guardrails.ts`). |
| **Important messages and pending follow-ups** | **Needs you now** on the overview; a follow-up list in both directions — *waiting on us* and *waiting on them* — that closes itself when the other side writes, even if the reply was sent from a phone (`lib/domain/followups.ts`). |
| **Conversation history** | The thread is reassembled from the conversation's messages, newest first within a budget, with the opening message kept for context and omissions marked (`lib/domain/thread.ts`). Quote separators from Outlook desktop and web, Gmail and Apple Mail are recognised in both languages (`lib/domain/quoting.ts`). |
| **English and Spanish** | The reply language is decided deterministically from the sender's own words — not left to the model — with the mailbox default for messages too short to tell. Every draft can be rewritten in the other language with one click. Signatures, categories and folder names are bilingual. |
| **Rules per mailbox** | Shared rules plus per-mailbox rules, ordered, with `stop`. A visual editor with a **dry run** against recent mail that changes nothing (`components/rule-editor.tsx`). |
| **Central dashboard** | Overview, unified inbox, approvals, follow-ups, rules, mailboxes, activity log — updating live over server-sent events. |
| **OpenAI, Gemini and Claude** | All three, through their official SDKs, each with native structured output, behind one interface. Triage and drafting have separate, configurable provider chains with automatic fallback; the offline engine is always the last link, so mail keeps flowing through an outage (`lib/ai/`). |
| **Outlook desktop and web** | Everything the agent does is native Outlook state. And an **Office.js add-in** puts the agent inside Outlook itself: analysis and a bilingual draft for the open message, inserted into Outlook's own reply form (`components/taskpane.tsx`, manifest at `/addin/manifest.xml`). |
| **Entra ID, OAuth 2.0, secure auth** | Authorization code + PKCE, delegated permissions per mailbox, refresh tokens encrypted with AES-256-GCM bound to the account id, Graph webhooks authenticated by a per-subscription secret compared in constant time, add-in calls verified as Entra-issued JWTs for this app and tenant. |
| **n8n / Power Automate** | A rule action posts an HMAC-signed webhook with the classification (never the email body) to any flow. |

---

## How a message moves

```
Graph notification ─┐                          ┌─ categorise ─┐
delta sync ─────────┼─▶ queue ─▶ thread ─▶ classify ─▶ score ─▶ rules ─┤─ flag         ├─▶ activity log
simulator ──────────┘  (per      (rebuilt   (model,     (arith-  (data  ├─ draft/reply ─┤   + live update
                        mailbox)  from msgs) structured) metic)   people ├─ webhook      │
                                                                  wrote) └─ file (last) ─┘
                                                                              │
                                                              guardrails ◀────┘ for any automatic reply
```

**The model classifies; rules decide.** This is the central design decision ([ADR 0002](docs/adr/0002-model-classifies-rules-decide.md)). An email can contain text aimed at the model — the demo includes one that asks the "AI assistant reading this" to email out customer addresses and confirm a refund. The worst such text can do here is influence a classification: the model is never given tools, recipients or actions, its output is a validated schema with no field that can cause one, and what happens to a message is decided by rules a person wrote. The demo message is flagged, its action items are marked untrusted, and its reply is held — with the reasons on screen.

---

## Modes

Each mailbox has a mode, and the mode is a ceiling on what any rule can do:

| | |
| --- | --- |
| **Observe** | Classify and log only. The mailbox is untouched. Every newly connected mailbox starts here. |
| **Assist** | File, categorise, flag. Replies are written to Drafts and wait for a person. |
| **Autopilot** | As Assist, and rules may send replies — each one still passing every guardrail. |

The intended rollout is a week in Observe reading what it *would* have done, then Assist, then Autopilot for the narrow cases that have earned it (support acknowledgements, meeting scheduling) while legal, billing, HR and anything uncertain stay with a person.

---

## Project layout

```
app/                 routes, Server Actions, API (Graph webhooks, OAuth, SSE, add-in)
components/          console UI — server components except where state is needed
lib/domain/          pure rules: priority, guardrails, rules engine, folders, follow-ups,
                     language, quoting, threads. No I/O; this is what the tests cover.
lib/ai/              provider SDKs, prompts, schemas, routing, offline engine
lib/graph/           OAuth, Graph client, mailbox, sync, notifications, token crypto
lib/mail/            the mailbox interface and the simulated mailbox
lib/agent/           pipeline, executor, drafts, follow-up sweep, queue, worker
lib/demo/            demo mailboxes, mail and simulator
docs/                ADRs, runbook, security notes
tests/               node:test, no network
```

---

## Documentation

- [Runbook](docs/RUNBOOK.md) — Entra app registration, permissions, deployment, operations
- [Security](docs/SECURITY.md) — threat model: prompt injection, token theft, webhook forgery, mail loops
- Architecture decisions:
  [0001 architecture](docs/adr/0001-architecture.md) ·
  [0002 the model classifies, rules decide](docs/adr/0002-model-classifies-rules-decide.md) ·
  [0003 Microsoft 365 integration](docs/adr/0003-microsoft-365-integration.md) ·
  [0004 model routing](docs/adr/0004-model-routing.md) ·
  [0005 Outlook add-in](docs/adr/0005-outlook-add-in.md)

---

## What a production deployment adds

Stated plainly rather than implied:

- **Postgres in place of the JSON store** when running more than one instance or more than a few thousand messages a day. The store is one module behind a small API; ADR 0001 explains the trade.
- **Entra single sign-on for the console**, restricted to an operators group, replacing the HTTP Basic stop-gap.
- **A durable queue** (Azure Service Bus or Postgres `SKIP LOCKED`) if webhook volume outgrows one process. The queue interface is already the seam.
- **An evaluation set from the client's own mail.** `npm run eval:triage` runs any labelled set; the demo labels are a placeholder for a few hundred real, categorised messages.
