import { notFound } from 'next/navigation'
import type { RuleInput } from '@/app/actions'
import { RuleEditor } from '@/components/rule-editor'
import { PageHead } from '@/components/ui'
import { CATEGORIES } from '@/lib/domain/categories'
import { store } from '@/lib/runtime'
import { CATEGORY_KEYS } from '@/lib/types'

export const metadata = { title: 'Rule' }

export default async function RulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ account?: string }> }) {
  const { id } = await params
  const { account } = await searchParams
  const db = store().read

  let initial: RuleInput
  if (id === 'new') {
    initial = {
      accountId: account && db.accounts.some((a) => a.id === account) ? account : null,
      name: '',
      enabled: true,
      order: 60,
      stop: false,
      when: [{ field: 'category', op: 'is', value: 'client-request' }],
      then: [{ type: 'move', folder: 'Clients/{senderOrg}' }],
    }
  } else {
    const rule = db.rules.find((r) => r.id === id)
    if (!rule) notFound()
    initial = { id: rule.id, accountId: rule.accountId, name: rule.name, enabled: rule.enabled, order: rule.order, stop: rule.stop, when: rule.when, then: rule.then } as RuleInput
  }

  return (
    <>
      <PageHead title={id === 'new' ? 'New rule' : initial.name} lede="Conditions read the agent’s analysis and the message itself. Actions change the mailbox, in Outlook, for real." />
      <RuleEditor
        initial={initial}
        accounts={db.accounts.map((a) => ({ value: a.id, label: a.displayName }))}
        categories={CATEGORY_KEYS.map((k) => ({ value: k, label: CATEGORIES[k].label.en }))}
      />
    </>
  )
}
