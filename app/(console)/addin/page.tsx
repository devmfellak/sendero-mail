import Link from 'next/link'
import { Card, PageHead } from '@/components/ui'
import { env } from '@/lib/env'

export const metadata = { title: 'Outlook add-in' }

export default function AddinPage() {
  const origin = env().APP_ORIGIN
  return (
    <>
      <PageHead
        title="Outlook add-in"
        lede="The agent inside Outlook: open any email in Outlook desktop (new and classic), Outlook on the web or Mac, and the Sendero pane shows its analysis and drafts a reply in English or Spanish."
        action={
          <a className="btn primary" href="/addin/manifest.xml" download>
            Download manifest
          </a>
        }
      />
      <div className="split">
        <div className="stack">
          <Card title="What it does">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Reads the open message through Office.js — nothing is sent anywhere until the pane is opened.</li>
              <li>Shows category, priority with its reasons, language, deadline and what is being asked.</li>
              <li>Drafts a reply in the sender’s language, or the other one, and opens it in Outlook’s own reply window with one click — the person reviews and presses Send.</li>
              <li>Works for any mailbox the user opens, including ones not enrolled for automation.</li>
            </ul>
          </Card>
          <Card title="Install for yourself (sideload)">
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                Download the manifest above. It points at <span className="mono">{origin}</span>.
              </li>
              <li>
                Outlook on the web: open <span className="mono">aka.ms/olksideload</span>, choose <em>My add-ins → Add a custom add-in → Add from file</em>.
              </li>
              <li>Outlook desktop picks it up from the same account within a few minutes.</li>
            </ol>
          </Card>
          <Card title="Deploy to the organisation">
            <p>
              In the Microsoft 365 admin centre: <em>Settings → Integrated apps → Upload custom apps</em>, upload the manifest, and assign it to users or groups. Centrally deployed add-ins
              appear in every assigned user’s Outlook without any action on their part.
            </p>
            <p className="small muted">
              In production the pane authenticates with Entra single sign-on (nested app authentication): the API checks the token’s signature, issuer and audience before analysing
              anything. See docs/adr/0005-outlook-add-in.md.
            </p>
          </Card>
        </div>
        <Card title="Try the pane here">
          <p className="small muted">The same page Outlook loads. Opened outside Outlook, it runs against a sample email so it can be seen working.</p>
          <Link className="btn" href="/addin/taskpane" target="_blank">
            Open task pane preview
          </Link>
        </Card>
      </div>
    </>
  )
}
