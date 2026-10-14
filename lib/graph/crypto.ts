import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto'

/**
 * Refresh tokens at rest.
 *
 * A Graph refresh token with Mail.ReadWrite and Mail.Send is, for practical
 * purposes, the mailbox. It is encrypted with AES-256-GCM under a key held only
 * in the environment, with the account id bound in as additional authenticated
 * data — so a token copied from one account's record onto another's fails to
 * decrypt instead of quietly granting access to the wrong mailbox.
 */

const VERSION = 'v1'

export function encryptToken(plaintext: string, keyB64: string, accountId: string): string {
  const key = parseKey(keyB64)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(accountId))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.')
}

export function decryptToken(sealed: string, keyB64: string, accountId: string): string {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || !body) throw new Error('Unrecognised token format')
  const decipher = createDecipheriv('aes-256-gcm', parseKey(keyB64), Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(accountId))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}

function parseKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  return key
}

/** PKCE (RFC 7636), S256. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
