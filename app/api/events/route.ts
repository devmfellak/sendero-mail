import { bus, type LiveEvent } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

/**
 * Server-sent events: the dashboard's live channel. One-way, plain HTTP,
 * reconnects by itself — everything this needs and nothing a WebSocket would
 * add. A comment line every 25 s keeps proxies from closing an idle stream.
 */
export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: LiveEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          cleanup()
        }
      }
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          cleanup()
        }
      }, 25_000)

      bus().on('live', send)
      controller.enqueue(encoder.encode('retry: 5000\n\n'))

      cleanup = () => {
        clearInterval(ping)
        bus().off('live', send)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      request.signal.addEventListener('abort', () => cleanup())
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
