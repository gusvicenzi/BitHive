import type { MinerAdapter, Reading } from './adapter.js';
import { infoSchema, normalize, validateCapabilities } from './adapter.js';
import type { Settings } from '../shared/domain.js';

export class DemoAdapter implements MinerAdapter {
  private state = new Map<string, Settings>();
  restore(address: string, settings: Settings) { this.state.set(address, settings); }
  async read(address: string): Promise<Reading> {
    const index = Number(address.split('-').at(-1)) || 1;
    const settings = { frequency: 525, coreVoltage: 1150, autofanspeed: 1, manualFanSpeed: 60, stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: `demo.worker${index}`, fallbackStratumURL: 'backup.example.com', fallbackStratumPort: 3334, fallbackStratumUser: `demo.backup${index}`, ...this.state.get(address) };
    const wave = Math.sin(Date.now() / 18000 + index);
    const raw = infoSchema.parse({
      ...settings, ASICModel: index === 3 ? 'BM1366' : 'BM1370', deviceModel: index === 1 ? 'Starminer 601' : index === 3 ? 'Ultra' : 'Gamma',
      version: 'demo-0.1', boardVersion: index === 3 ? '401' : '601', macAddr: `02:00:00:00:00:0${index}`, hostname: settings.hostname ?? address,
      hashRate: (index === 3 ? 520 : 1200) * (settings.frequency ?? 525) / 525 + wave * 32,
      voltage: 5100 + index * 10,
      expectedHashrate: (index === 3 ? 520 : 1200) * (settings.frequency ?? 525) / 525, actualFrequency: settings.frequency,
      overheat_mode: 0, miningPaused: false, resetReason: 'POWERON',
      power: index === 3 ? 12.8 : 17.2 + index, temp: 49 + index * 2 + wave,
      vrTemp: 56 + index, errorPercentage: 0.2, sharesAccepted: Math.floor(Date.now() / 30000) % 10000,
      sharesRejected: index, uptimeSeconds: Math.floor(Date.now() / 1000) % 100000, fanrpm: 3900 + index * 100, bestDiff: '2.41G',
    });
    return { raw, snapshot: normalize(raw, { deviceModel: raw.deviceModel, frequencyOptions: [400, 450, 500, 525, 550, 575], voltageOptions: [1100, 1150, 1200] }) };
  }
  async patchTuning(address: string, settings: Settings, reading: Reading) {
    this.state.set(address, { ...reading.snapshot.settings, ...settings });
  }
  async patch(address: string, settings: Settings, reading: Reading, customValuesAcknowledged = false) {
    validateCapabilities(settings, reading.snapshot, customValuesAcknowledged);
    this.state.set(address, { ...reading.snapshot.settings, ...settings, stratumPassword: undefined, fallbackStratumPassword: undefined });
  }
}
