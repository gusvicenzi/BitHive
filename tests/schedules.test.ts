import { describe, expect, it } from 'vitest';
import { schedulePeriod, scheduleSchema, operatingSettingsSchema, type ChangePoint } from '../src/shared/schedules.js';
const points: ChangePoint[] = [
  { id: 'day', name: 'Day', days: [0, 1, 2, 3, 4, 5, 6], time: '08:00' },
  { id: 'night', name: 'Night', days: [0, 1, 2, 3, 4, 5, 6], time: '22:00' },
];
const period = (at: string, timeZone = 'UTC', changePoints = points) => schedulePeriod(changePoints, timeZone, Date.parse(at));
describe('weekly schedule calendar', () => {
  it('holds the previous night through midnight and switches exactly on the boundary', () => {
    expect(period('2026-10-26T07:59:59Z').current).toMatchObject({ pointId: 'night', at: '2026-10-25T22:00:00.000Z' });
    expect(period('2026-10-26T08:00:00Z').current.pointId).toBe('day');
    expect(period('2026-10-26T08:00:00Z').next.at).toBe('2026-10-26T22:00:00.000Z');
  });
  it('wraps sparse weekday schedules into the previous and following week', () => {
    const weekly = [{ ...points[0], days: [1] }];
    expect(period('2026-10-26T07:00:00Z', 'UTC', weekly)).toMatchObject({ current: { at: '2026-10-19T08:00:00.000Z' }, next: { at: '2026-10-26T08:00:00.000Z' } });
  });
  it('uses the saved timezone rather than the host timezone, including fractional offsets', () => {
    expect(period('2026-10-26T10:59:00Z', 'America/Sao_Paulo').current.pointId).toBe('night');
    expect(period('2026-10-26T11:00:00Z', 'America/Sao_Paulo').current.pointId).toBe('day');
    expect(period('2026-10-26T02:15:00Z', 'Asia/Kathmandu').current.pointId).toBe('day');
  });
  it('moves spring-forward missing times to the first valid instant', () => {
    const gap = [{ ...points[0], time: '02:30' }];
    expect(period('2026-03-08T06:59:00Z', 'America/New_York', gap).next.at).toBe('2026-03-08T07:00:00.000Z');
    expect(period('2026-03-08T07:00:00Z', 'America/New_York', gap).current.at).toBe('2026-03-08T07:00:00.000Z');
  });
  it('runs a repeated fall-back time only at its first occurrence', () => {
    const fold = [{ ...points[0], time: '01:30' }];
    const result = period('2026-11-01T06:00:00Z', 'America/New_York', fold);
    expect(result.current.at).toBe('2026-11-01T05:30:00.000Z');
    expect(result.next.at).toBe('2026-11-02T06:30:00.000Z');
  });
  it('rejects invalid timezones, duplicate times, duplicate miners and foreign point keys', () => {
    const input = { name: 'Home', timeZone: 'UTC', points, members: [] };
    expect(scheduleSchema.safeParse(input).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...input, timeZone: 'Mars/Base' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...input, points: [points[0], { ...points[1], time: '08:00' }] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...input, points: [{ ...points[0], days: [] }] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...input, points: [{ ...points[0], time: '24:00' }] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...input, members: [{ deviceId: 'a', assignments: { missing: 'p' } }] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...input, members: [{ deviceId: 'a', assignments: {} }, { deviceId: 'a', assignments: {} }] }).success).toBe(false);
  });
  it('limits profiles to operating settings and makes fixed fan mode explicit', () => {
    expect(operatingSettingsSchema.safeParse({ frequency: 500, stratumPassword: 'secret' }).success).toBe(false);
    expect(operatingSettingsSchema.safeParse({ hostname: 'test' }).success).toBe(false);
    expect(operatingSettingsSchema.safeParse({ manualFanSpeed: 50 }).success).toBe(false);
    expect(operatingSettingsSchema.safeParse({ autofanspeed: 0, manualFanSpeed: 50 }).success).toBe(true);
  });
});
