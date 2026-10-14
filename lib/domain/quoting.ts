/**
 * Separating what someone wrote from what they quoted.
 *
 * Every reply carries the whole thread below it. Feeding that to a model wastes
 * tokens, and worse, it lets an old message's words be mistaken for the new
 * one's — the classic failure is an agent replying to a question that was
 * answered three emails ago. The thread is reassembled separately, from the
 * messages themselves, in `thread.ts`.
 *
 * Covers the separators Outlook (desktop and web), Gmail and Apple Mail emit,
 * in English and Spanish, plus `>`-quoting and the usual sign-off furniture.
 */

const QUOTE_HEADERS: RegExp[] = [
  // Gmail / Apple: "On Tue, 3 Mar 2026 at 10:02, Ana <ana@x> wrote:"
  /^On .{6,200}wrote:\s*$/im,
  // Spanish Gmail: "El mar, 3 mar 2026 a las 10:02, Ana (<ana@x>) escribió:"
  /^El .{6,200}escribi[oó]:\s*$/im,
  // Outlook desktop
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^-{2,}\s*Mensaje original\s*-{2,}\s*$/im,
  // Outlook web / new Outlook: a "From:" block followed by Sent/Date within a few lines
  /^\s*(From|De):\s.+\n(.*\n){0,2}\s*(Sent|Date|Enviado|Fecha):\s.+$/im,
  // A rule of underscores Outlook inserts above the header block
  /^_{20,}\s*$/m,
]

const SIGNOFF = /^(--\s*|Sent from my \w+.*|Enviado desde mi \w+.*|Get Outlook for \w+.*|Obtener Outlook para \w+.*)$/im

export function stripQuoted(body: string): string {
  const text = body.replace(/\r\n?/g, '\n')

  let cut = text.length
  for (const pattern of QUOTE_HEADERS) {
    const match = pattern.exec(text)
    if (match && match.index < cut) cut = match.index
  }

  const sig = SIGNOFF.exec(text)
  if (sig && sig.index < cut) cut = sig.index

  const kept = text
    .slice(0, cut)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')

  return kept.replace(/\n{3,}/g, '\n\n').trim()
}
