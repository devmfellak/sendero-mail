# 0003 — Microsoft 365 integration

**Status:** accepted · **Date:** 2026-09-30

## Context

The agent needs to read and change mail in Exchange Online mailboxes, visibly in Outlook desktop and web, for several mailboxes at once, with authentication an IT administrator will approve.

## Decisions

### Microsoft Graph, not EWS or IMAP

EWS is being retired for Exchange Online, and IMAP cannot create Outlook categories, flags with due dates, or threaded reply drafts. Graph covers every operation needed and is the only API Microsoft is investing in.

### Delegated permissions per mailbox, by default

Authorization code flow with PKCE against Entra ID. Scopes: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.Read`, `User.Read`, `offline_access`. Each mailbox owner, or an admin on their behalf, consents once; access can be revoked per user in Entra without touching anyone else.

**Alternative for central enrolment:** application permissions (`Mail.ReadWrite`, `Mail.Send` as application) with the client-credentials flow, scoped with **RBAC for Applications in Exchange Online** (formerly application access policies) to a mail-enabled security group. Without that scoping, application `Mail.ReadWrite` is every mailbox in the tenant. The code isolates token acquisition (`lib/graph/sync.ts → accessToken`) so this is a change to one function and an enrolment screen. Shared mailboxes work either way: under delegated permissions they need `Mail.ReadWrite.Shared` and the user's full access.

### Refresh tokens encrypted, bound to the account

AES-256-GCM under `TOKEN_ENCRYPTION_KEY`, with the account id as additional authenticated data. A token moved to another account's record fails to decrypt. Refresh tokens rotate and the newest is always stored. `invalid_grant` marks the mailbox **Reconnect needed** in the console rather than failing silently.

### Webhooks for latency, delta for correctness

Change notifications on `me/mailFolders('inbox')/messages` (created) deliver new mail within seconds. Graph documents that notifications can be delayed or dropped, so each mailbox is also reconciled from a stored **delta link** every 15 minutes and immediately on a `missed` lifecycle event. Sent Items is delta-synced too, so a reply sent from a phone closes a follow-up.

- Validation handshake: `validationToken` echoed as text/plain.
- Every notification's `clientState`, a random per-subscription secret, is compared in constant time; mismatches are dropped and counted.
- The endpoint answers 202 immediately and processes from the queue.
- Subscriptions are created for ~70 hours and renewed within 24 hours of expiry; a renew that 404s re-creates.

### Immutable ids and text bodies

Every request sends `Prefer: IdType="ImmutableId", outlook.body-content-type="text"`. Immutable ids mean a message keeps its id when the agent files it, so links do not break. Text bodies mean Exchange does the HTML-to-text conversion, which is better at Outlook's own markup than any sanitiser we would ship.

### Drafts through `createReply`

`POST /messages/{id}/createReply` with a `comment` produces a draft that is threaded, addressed and quotes the original exactly as Outlook's Reply button would. Editing is delete-and-recreate, because PATCHing the body would drop the quote.

### Throttling

Outlook limits each mailbox to roughly 10,000 requests per 10 minutes and 4 concurrent requests. The queue is serial per mailbox, and the client honours `Retry-After` on 429/503/504 with jittered exponential backoff.

## Consequences

- No mail content is stored beyond a capped working cache; the mailbox remains the record.
- A deployment needs a public HTTPS origin for webhooks. Without one it still works, on 15-minute delta sync.
