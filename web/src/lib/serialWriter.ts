// One in-flight write. RC/preview slots coalesce; STOP invalidates all pending work.
export class SerialWriter {
  private pending = new Map<string, { command: string; done: () => void }>()
  private busy = false
  private closed = false
  private stopping = false
  private lastKey = ''
  constructor(private writer: Pick<WritableStreamDefaultWriter<Uint8Array>, 'write'>,
    private transmitted: (command: string) => void, private failed: (error: unknown) => void,
    private timeoutMs = 250) {}
  send(command: string): Promise<void> {
    if (this.closed) return Promise.resolve()
    const key = command === 'STOP\n' ? 'stop' : command.startsWith('PREVIEW,') ? 'preview' : command.startsWith('RC,') ? 'rc' : 'control'
    if (command === 'STOP\n') { this.stopping = true; this.clear() }
    else if (command.startsWith('RESET,')) { this.stopping = false; this.clear(true) }
    else if (this.stopping && key !== 'preview') return Promise.resolve()
    return new Promise(resolve => {
      this.pending.get(key)?.done()
      this.pending.set(key, { command, done: resolve })
      void this.pump()
    })
  }
  private clear(keepStop = false) {
    for (const [key, item] of this.pending) { if (keepStop && key === 'stop') continue; item.done(); this.pending.delete(key) }
  }
  close() { this.closed = true; this.clear() }
  private async pump() {
    if (this.busy || this.closed) return
    const key = (this.lastKey === 'rc' ? ['stop', 'control', 'preview', 'rc'] : ['stop', 'control', 'rc', 'preview']).find(k => this.pending.has(k))
    if (!key) return
    const item = this.pending.get(key)!
    this.pending.delete(key); this.busy = true; this.lastKey = key
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Timing out retires this transport. It DOES NOT cancel the underlying write.
      await Promise.race([
        this.writer.write(new TextEncoder().encode(item.command)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Serial write timed out; transport retired, Arduino watchdog protects outputs')), this.timeoutMs) }),
      ])
      if (!this.closed) this.transmitted(item.command)
    } catch (error) { if (!this.closed) { this.close(); this.failed(error) } }
    finally { clearTimeout(timer); item.done(); this.busy = false; void this.pump() }
  }
}

// Bounds UI cleanup without claiming the underlying USB operation was cancelled.
export async function bounded(operation: Promise<unknown>, milliseconds = 350): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([operation.catch(() => undefined), new Promise(resolve => { timer = setTimeout(resolve, milliseconds) })]) }
  finally { clearTimeout(timer) }
}
