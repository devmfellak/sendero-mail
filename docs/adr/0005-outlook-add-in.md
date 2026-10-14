# 0005 — Outlook add-in

**Status:** accepted · **Date:** 2026-10-04

## Context

Most of the agent's value is delivered without any add-in: folders, categories, flags and drafts are native Outlook state, visible in every client. But people reading a message in Outlook also want the analysis and a draft *there*, on demand, including in mailboxes not enrolled for automation.

## Decision

A web add-in (Office.js), task pane on message read, served by the same application at `/addin/taskpane`.

- **XML add-in manifest**, generated per deployment at `/addin/manifest.xml` so staging and production need no hand-edited XML. It installs on classic and new Outlook for Windows, Mac and Outlook on the web, by sideload or through the admin centre's *Integrated apps*. The unified JSON manifest is the later migration, once the client's tenant standardises on it.
- **Read-only.** `ReadItem` permission. The pane reads subject, sender and body, calls `/api/addin/analyze`, and offers the draft through `displayReplyForm`. The person edits and sends in Outlook's own compose window, with their own signature. The add-in never sends mail.
- **Pinnable.** It follows the selection (`ItemChanged`), so it can stay open while the user moves through the inbox.
- **Authentication.** In a tenant deployment the pane obtains an Entra access token for this app (Office SSO now; nested app authentication via MSAL is the forward path). The API verifies the token's signature against Microsoft's keys, its expiry, an audience of this app, a well-formed issuer, and the tenant when one is pinned. In the demo there is no tenant, and the API runs unauthenticated against the offline engine.
- **CSP.** The task pane is the only route that may be framed, and only by Outlook's origins; the console sends `frame-ancestors 'none'`.

## Consequences

- One codebase and one deploy for console, agent and add-in.
- The pane works for any mailbox the user opens. If that mailbox is also enrolled, its signature, knowledge and VIP list are used.
