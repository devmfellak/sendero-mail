# Security notes

What can go wrong when software reads and sends a company's email, and what stops it here.

## Assets

1. **Mailbox access.** Graph refresh tokens with `Mail.ReadWrite` and `Mail.Send`.
2. **The ability to send as the organisation.** Automatic replies.
3. **Mail content**, passed to model providers.
4. **The console**, which can approve sends and change rules.

## Threats and controls

| Threat | Control | Where |
| --- | --- | --- |
| **Prompt injection** — an email instructs the model to exfiltrate data, add a link, or change behaviour | The model has no tools, and its outputs are closed schemas with no field that names a recipient or an action. Actions come only from rules a person wrote. Suspected injection is reported and holds any reply. The grounding check blocks any link, address, number or amount not present in the thread or knowledge. | ADR 0002 · `lib/domain/guardrails.ts` · `lib/ai/schema.ts` |
| **Model invents facts** (a price, a policy, a phone number) | The same grounding check. `needsHumanInput` from the drafting model holds the reply. The knowledge base is labelled as facts, not instructions. | `lib/ai/prompts.ts` |
| **Mail loops** between two auto-responders | No reply to Auto-Submitted, List-*, Precedence bulk/junk or no-reply senders. At most one automatic reply per conversation per day. An hourly cap per mailbox. | `isAutomatedSender` |
| **Wrong reply to a sensitive message** | Legal, billing, HR, spam, newsletters, notifications and personal mail are never auto-answered. Confidence threshold. Every mailbox starts in Observe mode. | `NEVER_AUTO_REPLY` |
| **Refresh token theft from storage** | AES-256-GCM with the key only in the environment. The account id is bound as AAD, so a token cannot be swapped onto another account. Tokens are never sent to the browser. | `lib/graph/crypto.ts` |
| **OAuth code interception / CSRF** | PKCE (S256) and a one-time `state` that expires after 15 minutes and is deleted on first use. | `api/auth/microsoft/*` |
| **Forged Graph webhooks** | A per-subscription random `clientState`, compared in constant time. Unknown subscriptions are rejected. Processing re-fetches the message from Graph rather than trusting the payload. | `lib/graph/notifications.ts` |
| **Forged add-in calls** | Entra JWT verified against Microsoft's JWKS: signature, expiry, audience of this app, issuer shape, and the pinned tenant. | `lib/addin/auth.ts` |
| **Console takeover** | Basic auth now, Entra SSO for production. Server Actions validate every input with Zod. The console sends `frame-ancestors 'none'`. | `middleware.ts` · `app/actions.ts` |
| **ReDoS through a rule regex** run against attacker text | Patterns with nested quantifiers are refused, and length is capped. | `safeRegex` |
| **Data sent to model providers** | Only the focus message and a bounded thread, with quoted history stripped. Webhook payloads carry the classification, never the body. Providers are configurable per organisation, for data residency. | `lib/domain/thread.ts` · `executor.ts` |
| **Outbound webhook abuse** (SSRF, spoofing) | https only. Bodies are signed with HMAC-SHA256 so receivers can verify them. URLs are set by operators, not by mail. | `executor.ts` |

## Known limits

- The JSON store holds encrypted tokens and the decision log on one volume. Protect it like a database: encryption at rest on the volume and restricted access.
- Basic auth is a stop-gap. It is shared-credential and has no audit of *which* operator approved a send; the log records "Operator". Entra SSO fixes both.
- The grounding check is lexical. It blocks novel concrete details; it does not judge whether a sentence is *true*. That is what the categories that are always reviewed, and the confidence threshold, are for.
