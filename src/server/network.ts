import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:http';
import { addressSchema } from '../shared/domain.js';
import { AppError } from './errors.js';

export function privateIPv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
export async function resolveAddress(host: string) {
  addressSchema.parse(host);
  const records = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, family: 4 });
  if (!records.length || records.some(record => !privateIPv4(record.address))) throw new AppError('localAddressRequired');
  return records[0].address;
}
export type Transport = (host: string, path: string, method?: 'GET' | 'PATCH', body?: unknown) => Promise<unknown>;
export const transport: Transport = async (host, path, method = 'GET', body) => {
  const address = await Promise.race([
    resolveAddress(host),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new AppError('deviceTimeout')), 5000); timer.unref(); }),
  ]);
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    // Connect to the validated address, not the hostname: DNS cannot change the target mid-request.
    const req = request({ hostname: address, port: 80, path, method,
      signal: AbortSignal.timeout(5000),
      headers: { Host: host, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512000) { req.destroy(new AppError('invalidDeviceResponse')); return; }
        chunks.push(chunk);
      });
      res.on('error', () => reject(new AppError('deviceUnavailable')));
      res.on('end', () => {
        if (res.statusCode === 404) return reject(new AppError('unsupported', 404));
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) return reject(new AppError('deviceRejected'));
        if (method !== 'GET') return resolve(undefined);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new AppError('invalidDeviceResponse')); }
      });
    });
    req.on('error', error => reject(error instanceof AppError ? error : new AppError('deviceUnavailable')));
    req.end(data);
  });
};
