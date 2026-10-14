# Runbook

## 1. Register the app in Microsoft Entra ID

Entra admin centre → **Identity → Applications → App registrations → New registration**.

| Field | Value |
| --- | --- |
| Name | Sendero |
| Supported account types | *Accounts in this organizational directory only* (single tenant) — or multitenant if you host it for several clients |
| Redirect URI | Web · `https://<your-origin>/api/auth/microsoft/callback` |

Then:

1. **Certificates & secrets → New client secret.** Copy the value into `MS_CLIENT_SECRET`, and note the expiry date in the operations calendar. A lapsed secret looks like every mailbox needing reconsent at once.
2. **API permissions → Add → Microsoft Graph → Delegated:** `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.Read`, `User.Read`, `offline_access`, `openid`, `profile`. Add `Mail.ReadWrite.Shared` if shared mailboxes will be enrolled. **Grant admin consent** so users are not prompted.
3. **Expose an API** (for the Outlook add-in): set the Application ID URI to `api://<your-host>/<client-id>`, add a scope `access_as_user`, and pre-authorise the Office client ids so the add-in's single sign-on works without a consent prompt:
   - `ea5a67f6-b6f3-4338-b240-c655ddc3cc8e` (all Microsoft Office application endpoints)
   - `d3590ed6-52b3-4102-aeff-aad2292ab01c` (Microsoft Office)
   - `bc59ab01-8403-45c6-8796-ac3ef710b3e3` (Outlook on the web)
4. Copy the **Application (client) ID** to `MS_CLIENT_ID` and the **Directory (tenant) ID** to `MS_TENANT_ID`.

Generate the token key once and store it in the secret store, never in the repository:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Losing `TOKEN_ENCRYPTION_KEY` means every mailbox must reconnect. Rotating it means the same: set the new key, then reconnect each mailbox.

## 2. Deploy

Any host that runs a long-lived Node 20+ process with a public HTTPS origin: Azure App Service (Linux, Node 22), Azure Container Apps, or a container on a VM. Not a scale-to-zero serverless platform, because the worker and the webhook queue live in the process (ADR 0001).

```bash
npm ci && npm run build && npm start
```

| Variable | Notes |
| --- | --- |
| `APP_ORIGIN` | The public https origin. Must match the redirect URI exactly. |
| `GRAPH_NOTIFICATION_ORIGIN` | Usually the same as `APP_ORIGIN`. Graph must reach it from the internet. |
| `DATA_DIR` | A persistent volume. On App Service, a path under `/home`. |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | Until SSO is configured. |
| Model keys | Any subset; see `.env.example`. |

Health check: `GET /api/health` returns queue depth, unprocessed count and mailboxes needing attention, with no mail content.

## 3. Connect mailboxes

**Mailboxes → Connect an Outlook mailbox.** The owner signs in, or an admin signs in as them. Each mailbox starts in **Observe** mode.

Recommended rollout per mailbox:

1. **Observe, one week.** Read the activity log. Adjust VIPs, internal domains, knowledge and rules. Use the rule editor's **Preview on recent mail** before enabling a rule.
2. **Assist.** Filing, flags and categories go live; replies wait in Drafts and in Approvals.
3. **Autopilot,** only for rules that have earned it. Watch the **Held** entries: each one says which guardrail stopped it.

## 4. Install the Outlook add-in

- **For one person:** download `/addin/manifest.xml`, then in Outlook on the web go to `aka.ms/olksideload` → *My add-ins → Add a custom add-in → Add from file*.
- **For the organisation:** Microsoft 365 admin centre → *Settings → Integrated apps → Upload custom apps* → upload the manifest and assign it to users or groups. It can take up to 24 hours to appear.

## 5. Local development with a real tenant

Graph needs a public URL for notifications. Use a tunnel and set both origins to it:

```bash
devtunnel host -p 3000 --allow-anonymous     # or: ngrok http 3000
# APP_ORIGIN=https://<tunnel>   GRAPH_NOTIFICATION_ORIGIN=https://<tunnel>
```

Register the tunnel URL as an additional redirect URI on the app registration.

## 6. Operations

| Symptom | Cause and fix |
| --- | --- |
| Mailbox shows **Reconnect needed** | Refresh token revoked or expired (password reset, MFA change, admin revocation, client secret expired). Owner clicks **Reconnect**. |
| New mail arrives late (minutes, not seconds) | Notifications not reaching the app. Check `GRAPH_NOTIFICATION_ORIGIN` is public HTTPS and look for `subscription` errors in the activity log. Delta sync still runs every 15 min. |
| "Rejected N change notifications" in the log | Notifications with the wrong `clientState`: a stale subscription from a previous deployment, or someone probing the endpoint. Harmless; stale subscriptions expire within 3 days. |
| Many replies **Held** for low confidence | Running on the offline engine, because a model key is missing or failing (see the badge in the top bar and `error` entries). Or the threshold is too high for this mailbox. |
| Graph 429s in the log | Normal under load and retried automatically. Persistent 429s on one mailbox mean another application is consuming its quota. |
| `error … Fell back to offline` | A provider timed out, refused or returned invalid output. The message was still processed. Check the provider's status and quota. |

**Backup:** `DATA_DIR/sendero.json` holds configuration, rules, encrypted tokens and the decision log. Snapshot the volume daily. Restoring an old file is safe: the pipeline is idempotent and delta sync catches up.

**Reset the demo:** `npm run demo:reset`, then restart.
