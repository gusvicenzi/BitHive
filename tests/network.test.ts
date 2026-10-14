import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock, requestMock } = vi.hoisted(() => ({ lookupMock: vi.fn(), requestMock: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));
vi.mock('node:http', () => ({ request: requestMock }));
import { resolveAddress, transport } from '../src/server/network.js';

beforeEach(() => { lookupMock.mockReset(); requestMock.mockReset(); });
function serve(statusCode: number, content: string, extra?: { disconnected?: boolean; fail?: boolean }) {
  requestMock.mockImplementation((_options: unknown, callback: (res: EventEmitter & { statusCode: number }) => void) => {
    const req = Object.assign(new EventEmitter(), {
      destroy(error: Error) { this.emit('error', error); },
      end: () => queueMicrotask(() => {
        if (extra?.fail) { req.emit('error', new Error('network')); return; }
        const res = Object.assign(new EventEmitter(), { statusCode });
        callback(res);
        if (extra?.disconnected) { res.emit('error', new Error('reset')); return; }
        res.emit('data', Buffer.from(content)); res.emit('end');
      }),
    });
    return req;
  });
}
describe('local network transport', () => {
  it('validates all DNS answers and rejects public/private mixed answers', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.5', family: 4 }, { address: '8.8.8.8', family: 4 }]);
    await expect(resolveAddress('bitaxe.local')).rejects.toThrow('localAddressRequired');
    lookupMock.mockResolvedValue([]);
    await expect(resolveAddress('bitaxe.local')).rejects.toThrow('localAddressRequired');
  });
  it('pins the validated address and keeps the original host in headers', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.1.5', family: 4 }]); serve(200, '{"version":"fixture"}');
    expect(await transport('bitaxe.local', '/api/system/info')).toEqual({ version: 'fixture' });
    expect(requestMock.mock.calls[0][0]).toMatchObject({ hostname: '192.168.1.5', port: 80, headers: { Host: 'bitaxe.local' } });
  });
  it('accepts empty PATCH acknowledgement without assuming JSON', async () => {
    serve(200, '');
    await expect(transport('192.168.1.5', '/api/system', 'PATCH', { frequency: 525 })).resolves.toBeUndefined();
    expect(requestMock.mock.calls[0][0]).toMatchObject({ method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
  });
  it('rejects redirects and errors without following other hosts', async () => {
    serve(302, ''); await expect(transport('192.168.1.5', '/api/system/info')).rejects.toThrow('deviceRejected');
    serve(404, ''); await expect(transport('192.168.1.5', '/api/system/asic')).rejects.toThrow('unsupported');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed and oversized JSON', async () => {
    serve(200, 'not json'); await expect(transport('192.168.1.5', '/api/system/info')).rejects.toThrow('invalidDeviceResponse');
    serve(200, 'x'.repeat(512001)); await expect(transport('192.168.1.5', '/api/system/info')).rejects.toThrow('invalidDeviceResponse');
  });
  it('handles request failure and interrupted responses without exposing external messages', async () => {
    serve(200, '', { fail: true }); await expect(transport('192.168.1.5', '/api/system/info')).rejects.toThrow('deviceUnavailable');
    serve(200, '', { disconnected: true }); await expect(transport('192.168.1.5', '/api/system/info')).rejects.toThrow('deviceUnavailable');
  });
  it('uses a bounded request signal and aborts stalled DNS resolution', async () => {
    vi.useFakeTimers();
    try {
      lookupMock.mockReturnValue(new Promise(() => {}));
      const result = expect(transport('bitaxe.local', '/api/system/info')).rejects.toThrow('deviceTimeout');
      await vi.advanceTimersByTimeAsync(5001); await result;
    } finally { vi.useRealTimers(); }
  });
});
