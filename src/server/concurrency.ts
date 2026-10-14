export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private limit = 4) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.queue.push(resolve));
    else this.active++;
    try { return await work(); }
    finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
export class DeviceLocks {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(work);
    this.tails.set(id, current);
    try { return await current; }
    finally { if (this.tails.get(id) === current) this.tails.delete(id); }
  }
}
