import type { FleetService } from './service.js';
import { retention } from './repository.js';

export class Collector {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private running?: Promise<void>;
  private lastRetention = 0;
  constructor(private service: FleetService, private report: (error: unknown) => void = () => {}) {}
  async tick() {
    const due = await this.service.db.device.findMany({ where: { nextPoll: { lte: new Date() } }, orderBy: { nextPoll: 'asc' }, take: 100 });
    await Promise.all(due.map(device => this.service.poll(device.id)));
    if (Date.now() - this.lastRetention > 3600000) {
      await retention(this.service.db);
      this.lastRetention = Date.now();
    }
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const loop = () => {
      this.running = this.tick().catch(this.report).finally(() => {
        if (!this.stopped) this.timer = setTimeout(loop, 1000);
      });
    };
    loop();
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.running; }
}
