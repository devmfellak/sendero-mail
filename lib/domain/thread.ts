import type { MailMessage } from '../types'
import { stripQuoted } from './quoting'

/**
 * Conversation context for the model.
 *
 * Built from the messages in the conversation — each one's own words, quoted
 * history removed — rather than from the quoted tail of the latest message,
 * which is truncated, reformatted and occasionally edited by whoever replied.
 *
 * The budget is spent newest-first: the message being answered is always
 * included whole, then as much of the preceding history as fits, then the
 * opening message (which usually states what the thread is about) if there is
 * room left. Anything dropped is replaced with a marker so the model knows the
 * history is incomplete instead of assuming it is not.
 */

export interface ThreadTurn {
  from: string
  direction: 'inbound' | 'outbound'
  at: string
  text: string
}

export interface ThreadContext {
  turns: ThreadTurn[]
  omitted: number
  chars: number
}

export function buildThread(
  messages: MailMessage[],
  focusId: string,
  budgetChars = 12_000,
): ThreadContext {
  const ordered = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  const focusIndex = ordered.findIndex((m) => m.id === focusId)
  // Messages after the focus are irrelevant to answering it.
  const relevant = focusIndex === -1 ? ordered : ordered.slice(0, focusIndex + 1)

  const turns = relevant.map(toTurn)
  if (turns.length === 0) return { turns: [], omitted: 0, chars: 0 }

  const focus = turns[turns.length - 1]!
  const chosen = new Set<number>([turns.length - 1])
  let used = focus.text.length

  for (let i = turns.length - 2; i >= 0; i--) {
    const cost = turns[i]!.text.length
    if (used + cost > budgetChars) break
    chosen.add(i)
    used += cost
  }

  if (!chosen.has(0) && turns.length > 1) {
    const opener = turns[0]!
    const clipped = clip(opener.text, Math.max(0, budgetChars - used))
    if (clipped.length > 200) {
      chosen.add(0)
      turns[0] = { ...opener, text: clipped }
      used += clipped.length
    }
  }

  const kept = turns.filter((_, i) => chosen.has(i))
  return { turns: kept, omitted: turns.length - kept.length, chars: used }
}

export function renderThread(ctx: ThreadContext): string {
  const parts: string[] = []
  ctx.turns.forEach((turn, i) => {
    if (i === 1 && ctx.omitted > 0) parts.push(`[… ${ctx.omitted} earlier message(s) omitted …]`)
    const who = turn.direction === 'outbound' ? `${turn.from} (us)` : turn.from
    parts.push(`<message from="${escapeAttr(who)}" at="${turn.at}">\n${turn.text}\n</message>`)
  })
  return parts.join('\n\n')
}

function toTurn(m: MailMessage): ThreadTurn {
  return {
    from: m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address,
    direction: m.direction,
    at: m.receivedAt,
    text: stripQuoted(m.bodyText),
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "'").replace(/[<>]/g, '')
}
