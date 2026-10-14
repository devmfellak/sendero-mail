/**
 * Runs once when the server process starts. Boots the worker: the queue, the
 * catch-up of unprocessed mail, follow-up sweeps, Graph subscription upkeep,
 * and — in the demo — the mail simulator.
 *
 * The import must sit inside this exact condition for Next to keep Node-only
 * modules out of the edge bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWorker } = await import('./lib/agent/worker')
    await startWorker()
  }
}
