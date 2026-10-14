import { Badge, Card, PageHead } from '@/components/ui'
import { chainFor, providers } from '@/lib/ai/router'
import { env, graphConfigured } from '@/lib/env'
import { SCOPES, redirectUri } from '@/lib/graph/oauth'

export const metadata = { title: 'Integrations' }

function Status({ on, off = 'Not configured' }: { on: boolean; off?: string }) {
  return on ? <Badge tone="green" dot>Configured</Badge> : <Badge tone="amber">{off}</Badge>
}

export default function SettingsPage() {
  const e = env()
  const all = providers()
  const triage = chainFor('triage')
  const draft = chainFor('draft')

  return (
    <>
      <PageHead
        title="Integrations"
        lede="What this deployment is connected to. Everything is configured through environment variables; nothing secret is stored in the dashboard or shown here."
      />
      <div className="stack">
        <Card title="Language models" tight>
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Status</th>
                <th>Variable</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['anthropic', 'Anthropic Claude', 'ANTHROPIC_API_KEY · ANTHROPIC_MODEL'],
                  ['openai', 'OpenAI', 'OPENAI_API_KEY · OPENAI_MODEL'],
                  ['gemini', 'Google Gemini', 'GEMINI_API_KEY · GEMINI_MODEL'],
                  ['offline', 'Sendero built-in', 'always available'],
                ] as const
              ).map(([id, label, vars]) => (
                <tr key={id}>
                  <td className="strong">{label}</td>
                  <td className="mono">{all[id].model}</td>
                  <td>{id === 'offline' ? <Badge tone="green" dot>Built in</Badge> : <Status on={all[id].configured()} />}</td>
                  <td className="mono small muted">{vars}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-body small">
            <p>
              <span className="strong">Triage chain:</span> {triage.map((p) => p.id).join(' → ')} <span className="muted">(AI_TRIAGE_ORDER)</span>
              <br />
              <span className="strong">Drafting chain:</span> {draft.map((p) => p.id).join(' → ')} <span className="muted">(AI_DRAFT_ORDER)</span>
            </p>
            <p className="muted">
              The first configured provider in each chain is used; on a timeout, rate limit, refusal or invalid output the next one is tried. The built-in engine is always last, so mail keeps
              flowing through a provider outage — at a confidence that keeps replies in review.
            </p>
          </div>
        </Card>

        <Card title="Microsoft 365 (Entra ID + Graph)">
          <div className="stack-sm">
            <div className="row">
              <Status on={graphConfigured()} />
              <span className="muted small">MS_CLIENT_ID · MS_CLIENT_SECRET · TOKEN_ENCRYPTION_KEY · MS_TENANT_ID</span>
            </div>
            <dl className="kv small">
              <dt>Tenant</dt>
              <dd className="mono">{e.MS_TENANT_ID}</dd>
              <dt>Redirect URI</dt>
              <dd className="mono">{redirectUri()}</dd>
              <dt>Delegated scopes</dt>
              <dd className="mono">{SCOPES.join(' ')}</dd>
              <dt>Notifications</dt>
              <dd>
                {e.GRAPH_NOTIFICATION_ORIGIN ? (
                  <span className="mono">{e.GRAPH_NOTIFICATION_ORIGIN}/api/graph/notifications</span>
                ) : (
                  <span className="muted">GRAPH_NOTIFICATION_ORIGIN not set — mail is picked up by delta sync every 15 minutes instead of instantly.</span>
                )}
              </dd>
            </dl>
            <p className="small muted">The step-by-step app registration is in docs/RUNBOOK.md.</p>
          </div>
        </Card>

        <div className="grid grid-2">
          <Card title="Automation platforms">
            <p className="small">
              Rules can call a webhook — an n8n Webhook node, a Power Automate “When an HTTP request is received” trigger, or Zapier. Each call carries the classification, not the email
              body, and is signed: <span className="mono">X-Sendero-Signature: sha256=…</span>
            </p>
            <Status on={Boolean(e.WEBHOOK_SIGNING_SECRET)} off="Unsigned (set WEBHOOK_SIGNING_SECRET)" />
          </Card>
          <Card title="Dashboard access">
            <p className="small">HTTP Basic authentication in front of every console page until single sign-on is wired to your tenant.</p>
            <Status on={Boolean(e.DASHBOARD_USER && e.DASHBOARD_PASSWORD)} off="Open (set DASHBOARD_USER / DASHBOARD_PASSWORD)" />
          </Card>
        </div>
      </div>
    </>
  )
}
