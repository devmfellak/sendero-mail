/**
 * A Graph HTTP client sized for one job.
 *
 * - Retries 429, 503 and 504, honouring `Retry-After`, with jittered backoff.
 *   Outlook throttles per mailbox (roughly 10,000 requests per 10 minutes and 4
 *   concurrent), so a busy mailbox *will* see 429s and they are not errors.
 * - Asks for immutable ids, so a message keeps its id when the agent moves it
 *   and the dashboard's links do not break the moment mail is filed.
 * - Asks for plain-text bodies; see mapping.ts.
 * - Refreshes the access token once on 401 and retries.
 */

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`Graph ${status} ${code}: ${message}`)
  }
}

export interface GraphClientOptions {
  getToken: (forceRefresh: boolean) => Promise<string>
  baseUrl?: string
  maxAttempts?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export class GraphClient {
  private readonly base: string
  private readonly maxAttempts: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly opts: GraphClientOptions) {
    this.base = opts.baseUrl ?? 'https://graph.microsoft.com/v1.0'
    this.maxAttempts = opts.maxAttempts ?? 5
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  delete(path: string): Promise<void> {
    return this.request<void>('DELETE', path)
  }

  /** Follow `@odata.nextLink` until exhausted or `limit` items collected. */
  async list<T>(path: string, limit = 1_000): Promise<T[]> {
    const items: T[] = []
    let next: string | undefined = path
    while (next && items.length < limit) {
      const page: { value: T[]; '@odata.nextLink'?: string } = await this.get(next)
      items.push(...page.value)
      next = page['@odata.nextLink']
    }
    return items.slice(0, limit)
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('https://') ? path : `${this.base}${path}`
    let forceRefresh = false

    for (let attempt = 1; ; attempt++) {
      const token = await this.opts.getToken(forceRefresh)
      forceRefresh = false

      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        })
      } catch (err) {
        if (attempt >= this.maxAttempts) throw err
        await this.sleep(backoff(attempt))
        continue
      }

      if (response.status === 401 && attempt === 1) {
        forceRefresh = true
        continue
      }

      if ((response.status === 429 || response.status === 503 || response.status === 504) && attempt < this.maxAttempts) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt))
        continue
      }

      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
        throw new GraphError(response.status, json.error?.code ?? 'unknown', json.error?.message ?? response.statusText)
      }

      if (response.status === 204 || response.status === 202) return undefined as T
      const text = await response.text()
      return (text ? JSON.parse(text) : undefined) as T
    }
  }
}

function backoff(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** (attempt - 1))
  return base / 2 + Math.random() * (base / 2)
}
