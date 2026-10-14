import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SettingsForm } from '@/components/settings-form'
import { AccountStatus, Badge, Card, ModeBadge, PageHead } from '@/components/ui'
import { folderTree } from '@/lib/domain/folders'
import { store } from '@/lib/runtime'

export const metadata = { title: 'Mailbox settings' }

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = store().read
  const account = db.accounts.find((a) => a.id === id)
  if (!account) notFound()

  const tree = folderTree(db.folders.filter((f) => f.accountId === account.id))
  const counts = new Map<string, number>()
  for (const m of db.messages) if (m.accountId === account.id) counts.set(m.folderId, (counts.get(m.folderId) ?? 0) + 1)
  const rules = db.rules.filter((r) => r.accountId === account.id || r.accountId === null)

  return (
    <>
      <nav className="small muted" style={{ marginBottom: 10 }}>
        <Link href="/accounts">Mailboxes</Link> / {account.displayName}
      </nav>
      <PageHead
        title={account.displayName}
        lede={
          <span className="row">
            {account.address} <ModeBadge mode={account.settings.mode} /> <AccountStatus account={account} />
          </span>
        }
      />
      <div className="split">
        <SettingsForm account={account} />
        <div className="stack">
          <Card title="Folders" tight>
            <ul className="tree" style={{ padding: '10px 16px' }}>
              {tree.map((f) => (
                <li key={f.id} style={{ paddingLeft: f.depth * 16 }}>
                  <span aria-hidden className="muted">
                    {f.depth ? '└' : '▪'}
                  </span>
                  <span className={f.wellKnown ? 'strong' : undefined}>{f.displayName}</span>
                  {f.createdByAgent && <Badge tone="teal">agent</Badge>}
                  <span className="spacer" />
                  <span className="tiny muted tnum">{counts.get(f.id) ?? ''}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={`Rules that apply · ${rules.filter((r) => r.enabled).length} on`} action={<Link className="small" href={`/rules/new?account=${account.id}`}>Add</Link>}>
            <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
              {rules
                .sort((a, b) => a.order - b.order)
                .map((r) => (
                  <li key={r.id} className={r.enabled ? undefined : 'muted'}>
                    <Link href={`/rules/${r.id}`}>{r.name}</Link>
                    {r.accountId === null && <span className="muted"> · shared</span>}
                    {!r.enabled && ' (off)'}
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
